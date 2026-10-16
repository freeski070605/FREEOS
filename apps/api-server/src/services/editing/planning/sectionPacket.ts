import { config } from "../../../config";
import type { CameraProfile, JsonObject } from "./plannerTypes";
import type { EvidenceRecord } from "../evidence/evidenceRefs";
import { buildSectionPlanSchema } from "./schemas";
import { number } from "../shared";

// The repo's general token estimator uses four characters per token. JSON schemas
// and numeric arrays tokenize less efficiently, so preflight uses three.
export const estimatePromptTokens = (value: unknown): number => Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 3);
export const sectionModelBudget = (numPredict: number, contextSize = config.heavyContextSize) => {
  const outputTokenReserve = Math.max(numPredict, config.heavyStructuredNumPredict);
  const safetyMargin = Math.max(2048, Math.ceil(contextSize * 0.07));
  return { contextSize, outputTokenReserve, safetyMargin, finalInputBudget: contextSize - outputTokenReserve - safetyMargin };
};

const priority: Record<string, number> = {
  "source-availability": 0, "audio-section-boundary": 8, "silence-boundary": 8,
  "scene-change": 7, "audio-transient": 7, "motion-shift": 6,
  "framing": 5, "face-presence": 4, "camera-motion": 3,
  "audio-energy": 2, "sharpness": 2, "exposure": 2, "semantic-confidence": 1,
};

function selectCatalog(catalog: EvidenceRecord[], candidates: JsonObject[], start: number, tier: number): EvidenceRecord[] {
  const selected = new Set<string>();
  for (const item of catalog) if (item.type === "source-availability" && Math.abs(item.at - start) <= 0.01) selected.add(item.id);
  const choose = (at: number, perClip: number, audioLimit: number) => {
    const local = catalog.filter((item) => Math.abs(item.at - at) <= 0.8)
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
  for (const candidate of candidates) choose(number(candidate.at, NaN), tier, tier);
  return catalog.filter((item) => selected.has(item.id));
}

export function buildSectionPacket(input: {
  start: number; end: number; videos: JsonObject[]; availability: JsonObject[];
  candidates: JsonObject[]; catalog: EvidenceRecord[]; intent: unknown; brief: unknown;
  profiles: CameraProfile[]; previousClipId: string; academy: string;
  system: string; numPredict: number; repair?: { category: string; message: string; rejected: string };
}) {
  const budget = sectionModelBudget(input.numPredict);
  const candidateTimes = input.candidates.map((c) => number(c.at, NaN)).filter(Number.isFinite);
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
  for (const tier of [3, 2, 1]) {
    const exposedCatalog = selectCatalog(input.catalog, input.candidates, input.start, tier);
    const packet = {
      section: [input.start, input.end], userIntent: input.intent, creativeBrief: input.brief,
      previousClipId: input.previousClipId || null,
      availability: input.availability.map((a) => ({ clipId: String(a.id), start: a.start, end: a.end })),
      candidateEditMoments: input.candidates.map((c) => ({ at: c.at, score: c.score,
        evidenceRefs: exposedCatalog.filter((e) => Math.abs(e.at - number(c.at, NaN)) <= 0.8).map((e) => e.id) })),
      evidenceCatalog: exposedCatalog.map((e) => ({ id: e.id, type: e.type, at: e.at,
        ...(e.clipId ? { clipId: e.clipId } : {}), ...(e.value !== undefined ? { value: e.value } : {}),
        ...(e.label ? { label: e.label } : {}) })),
      cameraProfiles: profiles, academyGuidance: academy,
      ...(input.repair ? { repair: input.repair } : {}),
    };
    const schema = buildSectionPlanSchema(input.start, input.end, input.videos, candidateTimes, exposedCatalog, input.previousClipId);
    const estimatedPromptTokens = estimatePromptTokens(input.system) + estimatePromptTokens(packet) + estimatePromptTokens(schema) + 256;
    if (estimatedPromptTokens <= budget.finalInputBudget) return {
      packet, schema, exposedCatalog, budget, estimatedPromptTokens,
      academyTokens: estimatePromptTokens(academy), intentTokens: estimatePromptTokens(input.intent),
      evidenceCatalogTokens: estimatePromptTokens(packet.evidenceCatalog),
      candidateTokens: estimatePromptTokens(packet.candidateEditMoments), schemaTokens: estimatePromptTokens(schema),
      compactionApplied: tier < 3,
    };
  }
  throw new Error(`context-budget: section ${input.start}-${input.end} cannot fit within ${budget.finalInputBudget} estimated input tokens after evidence compaction.`);
}
