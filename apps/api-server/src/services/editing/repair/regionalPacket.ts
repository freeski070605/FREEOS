import type { EditingDecision, JsonObject } from "../planning/plannerTypes";
import type { EvidenceRecord } from "../evidence/evidenceRefs";
import { creativeIntents } from "../evidence/evidenceRefs";
import { availableClipIdsAt, buildCandidateSupportIndex, isLocalSwitchEvidence, targetSupportRefs } from "../evidence/targetSupport";
import { estimatePromptTokens, sectionModelBudget } from "../planning/sectionPacket";
import { SectionValidationError } from "../validation/section";
import type { RepairRegion } from "./globalEditorialRepair";

type Support = ReturnType<typeof buildCandidateSupportIndex>[number];
const significance: Record<string, number> = { "audio-section-boundary": 8, "silence-boundary": 8, "scene-change": 7, "audio-transient": 7, "motion-shift": 6, framing: 5, "face-presence": 4, "camera-motion": 3, "motion-state": 3, sharpness: 2, exposure: 2, "audio-energy": 1 };

function representative(records: EvidenceRecord[], limit: number): EvidenceRecord[] {
  const sorted = [...records].sort((a, b) => (significance[b.type] ?? 0) - (significance[a.type] ?? 0) || a.id.localeCompare(b.id));
  const selected: EvidenceRecord[] = [], types = new Set<string>();
  for (const record of sorted) if (!types.has(record.type) && selected.length < limit) { selected.push(record); types.add(record.type); }
  for (const record of sorted) if (selected.length < limit && !selected.includes(record)) selected.push(record);
  return selected;
}

function thin<T extends { at: number; score: number }>(items: T[], limit: number, switchTimes: number[], start: number, end: number): T[] {
  if (items.length <= limit) return items;
  const chosen = new Set<T>();
  // Coverage follows the region's measured candidates; bins are selection quotas, never cut intervals.
  const bins = Math.max(1, Math.min(limit, Math.ceil(Math.sqrt(items.length))));
  for (let b = 0; b < bins && chosen.size < limit; b++) {
    const pool = items.filter((item) => Math.min(bins - 1, Math.floor((item.at - start) / Math.max(0.001, end - start) * bins)) === b);
    if (pool.length) chosen.add([...pool].sort((a, c) => c.score - a.score || a.at - c.at)[0]);
  }
  for (const at of switchTimes) {
    if (chosen.size >= limit) break;
    const closest = [...items].sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at) || b.score - a.score)[0];
    if (closest) chosen.add(closest);
  }
  while (chosen.size < limit) {
    const next = items.filter((item) => !chosen.has(item)).sort((a, b) => {
      const distance = (item: T) => Math.min(item.at - start, end - item.at, ...[...chosen].map((other) => Math.abs(item.at - other.at)));
      return (b.score + Math.min(4, distance(b))) - (a.score + Math.min(4, distance(a))) || a.at - b.at;
    })[0];
    if (!next) break;
    chosen.add(next);
  }
  return [...chosen].sort((a, b) => a.at - b.at);
}

export function buildRegionalRepairPacket(input: {
  region: RepairRegion; findings: unknown[]; candidates: JsonObject[]; catalog: EvidenceRecord[]; videos: JsonObject[];
  intent: unknown; classification: string; academy: string; system: string; numPredict: number;
}) {
  const { region, catalog } = input;
  const budget = sectionModelBudget(input.numPredict);
  const support = buildCandidateSupportIndex(input.candidates, catalog, input.videos);
  const byId = new Map(catalog.map((record) => [record.id, record]));
  if (byId.size !== catalog.length) throw new SectionValidationError("invalid-evidence-reference", "Canonical evidence catalog has duplicate IDs.");
  for (const candidate of support) {
    if (!Number.isFinite(candidate.at) || !input.candidates.some((item) => Number(item.at) === candidate.at)) throw new SectionValidationError("structure", "Repair candidate is absent from canonical candidates.");
    for (const [destination, refs] of Object.entries(candidate.targetSupport)) {
      if (!availableClipIdsAt(input.videos, candidate.at).includes(destination)) throw new SectionValidationError("target-grounding", "Repair destination is unavailable.");
      const legal = new Set(targetSupportRefs(catalog, input.videos, candidate.at, destination));
      for (const ref of refs) {
        const record = byId.get(ref);
        if (!record || record.clipId !== destination || !isLocalSwitchEvidence(record, candidate.at) || !legal.has(ref))
          throw new SectionValidationError("invalid-evidence-reference", `Canonical support mismatch for ${candidate.candidateId}/${destination}/${ref}.`);
      }
    }
  }
  const viable = support.map((item, index) => ({ ...item, score: Number(input.candidates[index].score) || 0 })).filter((item) => {
    const active = region.current.find((decision) => decision.start <= item.at && decision.end > item.at)?.clipId;
    return Object.entries(item.targetSupport).some(([clip, refs]) => clip !== active && refs.length);
  });
  const switches = region.current.slice(1).map((decision, index) => ({ id: `s${index}`, at: decision.start, clipId: decision.clipId }));
  const schema: JsonObject = { type: "object", additionalProperties: false, required: ["operations"], properties: { operations: { type: "array", maxItems: 32, items: { oneOf: [
    { type: "object", additionalProperties: false, required: ["operation", "candidateId", "destinationClipId", "creativeIntent"], properties: { operation: { const: "add-switch" }, candidateId: { type: "string" }, destinationClipId: { type: "string" }, creativeIntent: { enum: [...creativeIntents] } } },
    { type: "object", additionalProperties: false, required: ["operation", "existingSwitchId", "candidateId", "destinationClipId", "creativeIntent"], properties: { operation: { const: "replace-destination" }, existingSwitchId: { type: "string" }, candidateId: { type: "string" }, destinationClipId: { type: "string" }, creativeIntent: { enum: [...creativeIntents] } } },
    { type: "object", additionalProperties: false, required: ["operation", "existingSwitchId", "candidateId", "destinationClipId", "creativeIntent"], properties: { operation: { const: "move-switch" }, existingSwitchId: { type: "string" }, candidateId: { type: "string" }, destinationClipId: { type: "string" }, creativeIntent: { enum: [...creativeIntents] } } },
    { type: "object", additionalProperties: false, required: ["operation", "existingSwitchId"], properties: { operation: { const: "remove-switch" }, existingSwitchId: { type: "string" } } },
    { type: "object", additionalProperties: false, required: ["operation"], properties: { operation: { const: "hold" } } },
  ] } } } };
  const switchTimes = switches.map((item) => item.at);
  let result: ReturnType<typeof makePacket> | undefined;
  let smallest: ReturnType<typeof makePacket> | undefined;
  function makePacket(limit: number, guidance: number, detail: boolean) {
    const exposed = thin(viable, limit, switchTimes, region.start, region.end);
    const candidates = exposed.map((item) => ({ id: item.candidateId, at: item.at, score: item.score,
      timing: representative(catalog.filter((record) => isLocalSwitchEvidence(record, item.at) && (!record.clipId || record.type === "scene-change" || record.type === "motion-shift")), 2).map((record) => record.id),
      destinations: Object.fromEntries(Object.entries(item.targetSupport).filter(([, refs]) => refs.length).map(([clip, refs]) => [clip, detail ? representative(catalog.filter((record) => refs.includes(record.id)), 3).map((record) => ({ type: record.type, ...(record.label ? { label: record.label } : {}) })) : true])),
    }));
    const packet = { region: [region.start, region.end], openingClipId: region.openingClipId,
      prior: region.priorDecision && { at: region.priorDecision.start, clipId: region.priorDecision.clipId },
      next: region.nextDecision && { at: region.nextDecision.start, clipId: region.nextDecision.clipId }, exitClipBeforeRepair: region.exitClipBeforeRepair,
      current: region.current.map((decision) => ({ start: decision.start, end: decision.end, clipId: decision.clipId })), switches,
      findings: input.findings, userIntent: input.intent, classification: input.classification,
      candidates, academyGuidance: input.academy.slice(0, guidance) };
    const components = { globalRepairCandidateTokens: estimatePromptTokens(candidates), globalRepairSupportTokens: estimatePromptTokens(candidates.map((item) => item.destinations)), globalRepairTimelineTokens: estimatePromptTokens({ current: packet.current, switches, prior: packet.prior, next: packet.next }), globalRepairCriticTokens: estimatePromptTokens(input.findings), globalRepairAcademyTokens: estimatePromptTokens(packet.academyGuidance), globalRepairSchemaTokens: estimatePromptTokens(schema) };
    const estimated = estimatePromptTokens(input.system) + estimatePromptTokens(packet) + components.globalRepairSchemaTokens + 256;
    return { packet, candidates: exposed, estimated, components, detail };
  }
  for (const guidance of [1200, 400, 0]) {
    for (const detail of [true, false]) {
      for (let limit = viable.length; limit >= 0; limit = limit > 8 ? Math.max(8, Math.floor(limit * .75)) : limit - 1) {
        const candidate = makePacket(limit, guidance, detail);
        if (!smallest || candidate.estimated < smallest.estimated) smallest = candidate;
        if (candidate.estimated <= budget.finalInputBudget) { result = candidate; break; }
      }
      if (result) break;
    }
    if (result) break;
  }
  if (!result || (viable.length && !result.candidates.length)) throw new Error(`global-repair-context-budget: region ${region.start}-${region.end} cannot fit legal options; minimum estimate ${smallest?.estimated ?? 0}, input budget ${budget.finalInputBudget} tokens.`);
  return { ...result, schema, catalog, budget, support, switches, telemetry: {
    globalRepairEstimatedInputTokens: result.estimated, globalRepairInputBudget: budget.finalInputBudget,
    ...result.components, globalRepairCompactionApplied: result.candidates.length < viable.length || result.packet.academyGuidance.length < input.academy.length || !result.detail,
    rawRegionalCandidateCount: input.candidates.length, viableRegionalCandidateCount: viable.length,
    exposedRegionalCandidateCount: result.candidates.length, regionalCandidatesCompacted: viable.length - result.candidates.length,
  } };
}

export function resolveRegionalOperations(response: unknown, packet: ReturnType<typeof buildRegionalRepairPacket>, region: RepairRegion): JsonObject[] {
  if (!response || typeof response !== "object" || !Array.isArray((response as JsonObject).operations)) throw new SectionValidationError("structure", "Repair response requires operations.");
  const operations = (response as { operations: unknown[] }).operations;
  if (operations.length > 32) throw new SectionValidationError("structure", "Too many repair operations.");
  const switches = new Map(packet.switches.map((item, index) => [item.id, { at: item.at, clipId: item.clipId, action: region.current[index + 1].action, confidence: region.current[index + 1].confidence, creativeIntent: region.current[index + 1].creativeIntent, evidenceRefs: region.current[index + 1].evidenceRefs }]));
  const used = new Set<string>();
  for (const raw of operations) {
    if (!raw || typeof raw !== "object") throw new SectionValidationError("structure", "Invalid repair operation.");
    const op = raw as JsonObject, operation = op.operation;
    const allowedFields = new Set(["operation", "existingSwitchId", "candidateId", "destinationClipId", "creativeIntent"]);
    if (Object.keys(op).some((key) => !allowedFields.has(key))) throw new SectionValidationError("structure", "Repair operation contains unsupported fields.");
    if (operation === "hold") { if (Object.keys(op).length !== 1) throw new SectionValidationError("structure", "Hold cannot carry repair fields."); continue; }
    const existingId = op.existingSwitchId;
    if (operation === "add-switch" && existingId !== undefined) throw new SectionValidationError("structure", "Add-switch cannot reference an existing switch ID.");
    if (operation === "remove-switch" && Object.keys(op).some((key) => !["operation", "existingSwitchId"].includes(key))) throw new SectionValidationError("structure", "Remove-switch cannot carry candidate fields.");
    if (operation !== "add-switch") {
      if (typeof existingId !== "string" || !switches.has(existingId) || used.has(existingId)) throw new SectionValidationError("structure", "Unknown or repeated existing switch ID.");
      used.add(existingId);
      if (operation === "remove-switch" || operation === "move-switch" || operation === "replace-destination") switches.delete(existingId);
      else throw new SectionValidationError("structure", "Unsupported repair operation.");
      if (operation === "remove-switch") continue;
    }
    if (!["add-switch", "move-switch", "replace-destination"].includes(String(operation))) throw new SectionValidationError("structure", "Unsupported repair operation.");
    const candidate = packet.candidates.find((item) => item.candidateId === op.candidateId);
    const destination = op.destinationClipId;
    if (!candidate || typeof destination !== "string" || !candidate.targetSupport[destination]?.length) throw new SectionValidationError("target-grounding", `Candidate or destination is not exposed and supported. Legal options: ${packet.candidates.map((item) => `${item.candidateId}=[${Object.entries(item.targetSupport).filter(([, refs]) => refs.length).map(([clip]) => clip).join(",")}]`).join("; ").slice(0, 350)}.`);
    if (!creativeIntents.includes(op.creativeIntent as typeof creativeIntents[number])) throw new SectionValidationError("unsupported-creative-intent", "Invalid repair creative intent.");
    const target = representative(packet.catalog.filter((record) => candidate.targetSupport[destination].includes(record.id)), 4).map((record) => record.id);
    const timing = representative(packet.catalog.filter((record) => isLocalSwitchEvidence(record, candidate.at) && (!record.clipId || record.type === "scene-change" || record.type === "motion-shift")), 2).map((record) => record.id);
    const refs = [...new Set([...timing, ...target])].slice(0, 8);
    switches.set(typeof existingId === "string" ? existingId : `new${switches.size}`, { at: candidate.at, clipId: destination, action: "cut", confidence: 0.7, creativeIntent: op.creativeIntent as EditingDecision["creativeIntent"], evidenceRefs: refs });
  }
  return [...switches.values()].sort((a, b) => a.at - b.at).map((item) => ({ ...item }));
}
