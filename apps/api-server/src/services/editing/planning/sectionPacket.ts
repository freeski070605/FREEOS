import { config } from "../../../config";
import type { CameraProfile, JsonObject } from "./plannerTypes";
import type { EvidenceRecord } from "../evidence/evidenceRefs";
import { openingEvidenceByClip, type OpeningEvidenceScope } from "../evidence/openingEvidence";
import { buildSectionChoiceSchema } from "./schemas";
import { number } from "../shared";
import { buildCandidateSupportIndex, isLocalSwitchEvidence } from "../evidence/targetSupport";
import { SectionValidationError } from "../validation/section";

// The repo's general token estimator uses four characters per token. JSON schemas
// and numeric arrays tokenize less efficiently, so preflight uses three.
export const estimatePromptTokens = (value: unknown): number => Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 3);
export const sectionModelBudget = (numPredict: number, contextSize = config.heavyContextSize) => {
  const outputTokenReserve = Math.max(numPredict, config.heavyStructuredNumPredict);
  const safetyMargin = Math.max(2048, Math.ceil(contextSize * 0.07));
  return { contextSize, outputTokenReserve, safetyMargin, finalInputBudget: contextSize - outputTokenReserve - safetyMargin };
};
export class ContextBudgetPlanningError extends Error {
  readonly code = "context-budget";
  constructor(public readonly details: { section: string; estimatedInputTokens: number; inputBudget: number; compactionApplied: boolean; componentEstimates: Record<string, number>; phases: Array<{ phase: string; estimatedInputTokens: number }> }) {
    super(`context-budget: section ${details.section} cannot fit within ${details.inputBudget} estimated input tokens after compaction.`);
  }
}

export function resolveSectionChoices(parsed: { opening: unknown; switches: unknown[] }, packet: ReturnType<typeof buildSectionPacket>, videos: JsonObject[], openingScope?: OpeningEvidenceScope): { opening: unknown; switches: JsonObject[] } {
  const byId = new Map(packet.supportIndex.map((item) => [item.candidateId, item]));
  const opening = parsed.opening && typeof parsed.opening === "object" ? { ...(parsed.opening as JsonObject) } : parsed.opening;
  if (opening && typeof opening === "object" && openingScope) {
    const clipId = String((opening as JsonObject).clipId ?? "");
    const refs = openingEvidenceByClip(videos, packet.exposedCatalog, openingScope).find((item) => item.clipId === clipId)?.evidenceRefs ?? [];
    if (!refs.length) throw new SectionValidationError("missing-evidence-reference", `Opening clip '${clipId}' has no measured opening support.`);
    (opening as JsonObject).evidenceRefs = refs.slice(0, 8);
  }
  const switches = parsed.switches.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new SectionValidationError("structure", `Section switch ${index} is invalid.`);
    const choice = raw as JsonObject;
    if (Object.keys(choice).some((key) => !["candidateId", "destinationClipId", "action", "confidence", "creativeIntent"].includes(key))) throw new SectionValidationError("structure", `Section switch ${index} has unsupported fields.`);
    const candidate = byId.get(String(choice.candidateId ?? ""));
    const clipId = String(choice.destinationClipId ?? "");
    const target = candidate?.targetSupport[clipId] ?? [];
    if (!candidate || !target.length) throw new SectionValidationError("target-grounding", `Section switch ${index} selects an unsupported candidate/destination.`);
    const timing = packet.exposedCatalog.filter((item) => isLocalSwitchEvidence(item, candidate.at) && (!item.clipId || item.type === "scene-change" || item.type === "motion-shift")).slice(0, 2).map((item) => item.id);
    return { at: candidate.at, clipId, action: choice.action, confidence: choice.confidence, creativeIntent: choice.creativeIntent, evidenceRefs: [...new Set([...target.slice(0, 3), ...timing])].slice(0, 8) };
  });
  return { opening, switches };
}

const priority: Record<string, number> = {
  "source-availability": 0, "audio-section-boundary": 8, "silence-boundary": 8,
  "scene-change": 7, "audio-transient": 7, "motion-shift": 6,
  "framing": 5, "face-presence": 4, "camera-motion": 3,
  "motion-state": 3,
  "audio-energy": 2, "sharpness": 2, "exposure": 2, "semantic-confidence": 1,
};

function selectCatalog(catalog: EvidenceRecord[], candidates: JsonObject[], start: number, tier: number, openingScope?: OpeningEvidenceScope): EvidenceRecord[] {
  const selected = new Set<string>();
  if (openingScope) for (const item of catalog) if (item.opening && item.at >= openingScope.start && item.at <= openingScope.end) selected.add(item.id);
  for (const item of catalog) if (item.type === "source-availability" && Math.abs(item.at - start) <= 0.01) selected.add(item.id);
  const choose = (at: number, perClip: number, audioLimit: number) => {
    const local = catalog.filter((item) => isLocalSwitchEvidence(item, at))
      .sort((a, b) => (priority[b.type] ?? 0) - (priority[a.type] ?? 0) || Math.abs(a.at - at) - Math.abs(b.at - at) || a.id.localeCompare(b.id));
    const counts = new Map<string, number>();
    for (const item of local) {
      const key = item.clipId ?? "audio";
      const limit = item.clipId ? perClip : audioLimit;
      if ((counts.get(key) ?? 0) >= limit) continue;
      selected.add(item.id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  };
  choose(start, 1, 1);
  for (const candidate of candidates) {
    const at = number(candidate.at, NaN);
    choose(at, tier, tier);
    const timing = catalog.find((item) => isLocalSwitchEvidence(item, at) &&
      (!item.clipId || item.type === "scene-change" || item.type === "motion-shift"));
    if (timing) selected.add(timing.id);
  }
  return catalog.filter((item) => selected.has(item.id));
}

export function buildSectionPacket(input: {
  start: number; end: number; videos: JsonObject[]; availability: JsonObject[];
  candidates: JsonObject[]; catalog: EvidenceRecord[]; intent: unknown; brief: unknown;
  profiles: CameraProfile[]; previousClipId: string; academy: string;
  system: string; numPredict: number; repair?: { category: string; message: string; rejected: string; failedSwitch?: { at: number; clipId: string; candidateId: string | null; currentClipId: string; supportedDestinations: Record<string, string[]>; holdAllowed: boolean } };
  openingScope?: OpeningEvidenceScope;
}) {
  const budget = sectionModelBudget(input.numPredict);
  // Academy retrieval is already query ranked. Keep whole retrieved units where possible.
  const academy = input.academy.slice(0, 3000);
  const profiles = input.profiles.map((p) => ({
    clipId: p.clipId, shotCharacter: String(p.shotCharacter ?? "").slice(0, 110),
    framingCharacter: String(p.framingCharacter ?? "").slice(0, 110),
    motionCharacter: String(p.motionCharacter ?? "").slice(0, 110),
    subjectVisibility: String(p.subjectVisibility ?? "").slice(0, 110),
    strengths: Array.isArray(p.strengths) ? p.strengths.slice(0, 2) : [],
    cautions: Array.isArray(p.cautions) ? p.cautions.slice(0, 2) : [],
    confidence: p.confidence,
  }));
  const phaseEstimates: Array<{ phase: string; estimatedInputTokens: number }> = [];
  let lastComponents: Record<string, number> = {};
  for (const [tier, candidateLimit, academyLimit] of [[3, input.candidates.length, 3000], [2, input.candidates.length, 1600], [1, input.candidates.length, 600], [1, 24, 400], [1, 16, 200], [1, 10, 0]] as const) {
    const exposedCatalog = selectCatalog(input.catalog, input.candidates, input.start, tier, input.openingScope);
    const allSupport = buildCandidateSupportIndex(input.candidates, exposedCatalog, input.videos);
    const viable = allSupport.map((item, index) => ({ ...item, score: number(input.candidates[index].score, 0) })).filter((item) => Object.values(item.targetSupport).some((refs) => refs.length));
    const retain = new Set<string>();
    if (viable.length <= candidateLimit) viable.forEach((item) => retain.add(item.candidateId));
    else {
      retain.add(viable[0].candidateId);
      retain.add(viable[viable.length - 1].candidateId);
      for (const source of input.availability) {
        for (const boundary of [number(source.start, NaN), number(source.end, NaN)]) {
          if (!Number.isFinite(boundary) || boundary <= input.start || boundary >= input.end || retain.size >= candidateLimit) continue;
          const nearby = [...viable].sort((a, b) => Math.abs(a.at - boundary) - Math.abs(b.at - boundary) || b.score - a.score)[0];
          if (nearby) retain.add(nearby.candidateId);
        }
      }
      const bins = Math.min(candidateLimit, Math.ceil(Math.sqrt(viable.length)));
      for (let bin = 0; bin < bins; bin++) {
        const pool = viable.filter((item) => Math.min(bins - 1, Math.floor((item.at - input.start) / Math.max(0.001, input.end - input.start) * bins)) === bin);
        const best = pool.sort((a, b) => b.score - a.score || a.at - b.at)[0];
        if (best) retain.add(best.candidateId);
      }
      for (const item of [...viable].sort((a, b) => b.score - a.score || a.at - b.at)) if (retain.size < candidateLimit) retain.add(item.candidateId);
    }
    const supportIndex = allSupport.filter((item) => retain.has(item.candidateId));
    const retainedCandidates = input.candidates.filter((_, index) => retain.has(allSupport[index].candidateId));
    const byId = new Map(exposedCatalog.map((item) => [item.id, item]));
    const summary = (ids: string[]) => ids.slice(0, 3).map((id) => { const item = byId.get(id)!; return { type: item.type, ...(item.label ? { label: item.label } : {}), ...(item.value !== undefined ? { value: Number(item.value.toFixed(2)) } : {}) }; });
    const opening = input.openingScope ? openingEvidenceByClip(input.videos, exposedCatalog, input.openingScope) : undefined;
    const packet = {
      section: [input.start, input.end], userIntent: input.intent, creativeBrief: input.brief,
      previousClipId: input.previousClipId || null,
      availability: input.availability.map((a) => ({ clipId: String(a.id), start: a.start, end: a.end })),
      candidateEditMoments: retainedCandidates.map((c) => { const support = supportIndex.find((item) => Math.abs(item.at - number(c.at, NaN)) <= 0.001)!; return ({ at: c.at, candidateId: support.candidateId, score: c.score,
        timingEvidence: summary(exposedCatalog.filter((e) => isLocalSwitchEvidence(e, number(c.at, NaN)) && (!e.clipId || e.type === "scene-change" || e.type === "motion-shift")).map((e) => e.id)),
        targetSupport: Object.fromEntries(Object.entries(support.targetSupport).filter(([, refs]) => refs.length).map(([clip, refs]) => [clip, summary(refs)])) }); }),
      evidenceCatalog: [] as unknown[],
      ...(input.openingScope ? { openingEvidence: {
        windowStart: input.openingScope.start, windowEnd: input.openingScope.end,
        clips: opening?.map((item) => ({ clipId: item.clipId, evidence: item.evidence.map(({ id: _id, ...rest }) => rest), missing: item.missing, firstMeasurementAt: item.firstMeasurementAt })),
      } } : {}),
      cameraProfiles: profiles, academyGuidance: academy.slice(0, academyLimit),
      ...(input.repair ? { repair: { ...input.repair,
        ...(input.repair.failedSwitch ? { failedSwitch: {
          ...input.repair.failedSwitch,
          supportedDestinations: Object.fromEntries(Object.entries(supportIndex.find((item) => item.candidateId === input.repair?.failedSwitch?.candidateId)?.targetSupport ?? {}).filter(([, refs]) => refs.length).map(([clip]) => [clip, true])),
        } } : {}),
      } } : {}),
    };
    const schema = buildSectionChoiceSchema(input.videos, input.previousClipId, input.start, supportIndex.map((item) => item.candidateId));
    const estimatedPromptTokens = estimatePromptTokens(input.system) + estimatePromptTokens(packet) + estimatePromptTokens(schema) + 256;
    const idOccurrences = (JSON.stringify(packet).match(/"e_[A-Za-z0-9_-]{10}"/g) ?? []).join("");
    lastComponents = { systemTokens: estimatePromptTokens(input.system), intentTokens: estimatePromptTokens(input.intent), academyTokens: estimatePromptTokens(packet.academyGuidance), evidenceCatalogTokens: estimatePromptTokens(packet.evidenceCatalog), candidateTokens: estimatePromptTokens(packet.candidateEditMoments), candidateSupportTokens: estimatePromptTokens(packet.candidateEditMoments.map((item) => item.targetSupport)), cameraProfileTokens: estimatePromptTokens(profiles), continuityTokens: estimatePromptTokens({ previousClipId: packet.previousClipId, availability: packet.availability, openingEvidence: packet.openingEvidence }), schemaTokens: estimatePromptTokens(schema), evidenceIdTokenCost: Math.ceil(idOccurrences.length / 3) };
    phaseEstimates.push({ phase: `evidence-tier-${tier}-candidates-${candidateLimit}-academy-${academyLimit}`, estimatedInputTokens: estimatedPromptTokens });
    if (estimatedPromptTokens <= budget.finalInputBudget) return {
      packet, schema, exposedCatalog, budget, estimatedPromptTokens,
      academyTokens: estimatePromptTokens(packet.academyGuidance), intentTokens: estimatePromptTokens(input.intent),
      evidenceCatalogTokens: estimatePromptTokens(packet.evidenceCatalog),
      candidateTokens: estimatePromptTokens(packet.candidateEditMoments), schemaTokens: estimatePromptTokens(schema),
      componentEstimates: lastComponents, phases: phaseEstimates,
      compactionApplied: tier < 3 || candidateLimit < input.candidates.length || academyLimit < 3000, supportIndex, supportIndexCompactionCount: allSupport.length - supportIndex.length,
    };
  }
  const details = { section: `${input.start}-${input.end}`, estimatedInputTokens: phaseEstimates.at(-1)?.estimatedInputTokens ?? 0, inputBudget: budget.finalInputBudget, compactionApplied: true, componentEstimates: lastComponents, phases: phaseEstimates };
  console.error("[FREEOS Editing Planner] section packet context-budget", JSON.stringify({ ...details, overBudgetTokens: details.estimatedInputTokens - details.inputBudget }));
  throw new ContextBudgetPlanningError(details);
}
