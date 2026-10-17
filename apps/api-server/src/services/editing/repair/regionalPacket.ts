import type { EditingDecision, JsonObject } from "../planning/plannerTypes";
import type { EvidenceRecord } from "../evidence/evidenceRefs";
import { creativeIntents } from "../evidence/evidenceRefs";
import { availableClipIdsAt, buildCandidateSupportIndex, isLocalSwitchEvidence, targetSupportRefs } from "../evidence/targetSupport";
import { estimatePromptTokens, sectionModelBudget } from "../planning/sectionPacket";
import { SectionValidationError } from "../validation/section";
import type { RepairDeclineReason, RepairRegion, RepairProposal } from "./globalEditorialRepair";

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
  const operationSchema: JsonObject = { type: "object", additionalProperties: false, required: ["outcome", "operations"], properties: { outcome: { const: "repair" }, operations: { type: "array", minItems: 1, maxItems: 32, items: { oneOf: [
    { type: "object", additionalProperties: false, required: ["operation", "candidateId", "destinationClipId", "creativeIntent"], properties: { operation: { const: "add-switch" }, candidateId: { type: "string" }, destinationClipId: { type: "string" }, creativeIntent: { enum: [...creativeIntents] } } },
    { type: "object", additionalProperties: false, required: ["operation", "existingSwitchId", "candidateId", "destinationClipId", "creativeIntent"], properties: { operation: { const: "replace-destination" }, existingSwitchId: { type: "string" }, candidateId: { type: "string" }, destinationClipId: { type: "string" }, creativeIntent: { enum: [...creativeIntents] } } },
    { type: "object", additionalProperties: false, required: ["operation", "existingSwitchId", "candidateId", "destinationClipId", "creativeIntent"], properties: { operation: { const: "move-switch" }, existingSwitchId: { type: "string" }, candidateId: { type: "string" }, destinationClipId: { type: "string" }, creativeIntent: { enum: [...creativeIntents] } } },
    { type: "object", additionalProperties: false, required: ["operation", "existingSwitchId"], properties: { operation: { const: "remove-switch" }, existingSwitchId: { type: "string" } } },
  ] } } } };
  const declineSchema: JsonObject = { type: "object", additionalProperties: false,
    required: ["outcome", "basis"], properties: { outcome: { const: "decline" },
      reason: { enum: ["current-shot-preferred", "candidate-support-too-weak", "pacing-change-would-overcorrect"] },
      declineReason: { enum: ["current-shot-preferred", "candidate-support-too-weak", "pacing-change-would-overcorrect"] },
      basis: { enum: ["neighboring-micro-shots", "limited-destination-support", "current-hold-and-user-intent"] } },
    anyOf: [{ required: ["reason"] }, { required: ["declineReason"] }] };
  const schema: JsonObject = { oneOf: [operationSchema, declineSchema] };
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
      neighboringShotDurations: { previous: region.before.slice(-3).map((d) => Number((d.end - d.start).toFixed(3))),
        current: region.current.map((d) => Number((d.end - d.start).toFixed(3))), next: region.after.slice(0, 3).map((d) => Number((d.end - d.start).toFixed(3))) },
      repairObjective: { finding: region.finding, requiredEffect: requiredEditorialEffect(region.finding.code),
        mandate: region.finding.severity === "material" && viable.length > 0 && /more cuts|substantially more|visual energy|faster pac|high.energy|dynamic|energetic|punchier|more visual variety/i.test(JSON.stringify(input.intent))
          ? "Material finding conflicts with explicit user intent and grounded alternatives exist. Return a meaningful grounded timeline modification or explicitly decline with a constrained editorial reason." :
            "Return a meaningful grounded timeline modification or explicitly decline with a constrained editorial reason.",
        instruction: "Use neighboring shot durations to balance pacing and avoid overcorrection. Strong holds remain legal where they do not leave the material finding unanswered. Choose the cuts and destinations editorially." },
      opportunitySummary: { viableCandidateCount: viable.length, supportedDestinationCount: viable.reduce((sum, item) => sum + Object.values(item.targetSupport).filter((refs) => refs.length).length, 0) },
      findings: input.findings, userIntent: input.intent, classification: input.classification,
      candidates, academyGuidance: input.academy.slice(0, guidance) };
    const components = { globalRepairCandidateTokens: estimatePromptTokens(candidates), globalRepairSupportTokens: estimatePromptTokens(candidates.map((item) => item.destinations)), globalRepairTimelineTokens: estimatePromptTokens({ current: packet.current, switches, prior: packet.prior, next: packet.next }), globalRepairCriticTokens: estimatePromptTokens(input.findings), globalRepairAcademyTokens: estimatePromptTokens(packet.academyGuidance), globalRepairSchemaTokens: estimatePromptTokens(schema) };
    // Reserve room for the single no-op retry instruction and bounded validation diagnostic.
    const estimated = estimatePromptTokens(input.system) + estimatePromptTokens(packet) + components.globalRepairSchemaTokens + 512;
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

export function resolveRegionalDecline(response: unknown, packet: ReturnType<typeof buildRegionalRepairPacket>, region: RepairRegion): Extract<RepairProposal, { outcome: "decline" }> {
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new SectionValidationError("structure", "Invalid repair decline.");
  const value = response as JsonObject;
  const allowedKeys = new Set(["outcome", "reason", "declineReason", "basis"]);
  if (value.outcome !== "decline" || Object.keys(value).some((key) => !allowedKeys.has(key))) throw new SectionValidationError("structure", "Repair decline requires constrained outcome, reason, and basis only.");
  const reasons = ["current-shot-preferred", "candidate-support-too-weak", "pacing-change-would-overcorrect"];
  const bases = ["neighboring-micro-shots", "limited-destination-support", "current-hold-and-user-intent"];
  const reasonValue = typeof value.reason === "string" ? value.reason : typeof value.declineReason === "string" ? value.declineReason : undefined;
  const basisValue = typeof value.basis === "string" ? value.basis : undefined;
  if (reasonValue === undefined || !reasons.includes(reasonValue) || basisValue === undefined || !bases.includes(basisValue)) throw new SectionValidationError("structure", "Unsupported repair decline reason or basis.");
  if ("reason" in value && "declineReason" in value && String(value.reason) !== String(value.declineReason)) throw new SectionValidationError("structure", "Repair decline requires exactly one constrained reason.");
  const durations = [...region.before.slice(-3), ...region.current, ...region.after.slice(0, 3)].map((d) => d.end - d.start);
  const supported = packet.support.filter((item) => item.at >= region.start && item.at < region.end)
    .reduce((sum, item) => sum + Object.values(item.targetSupport).filter((refs) => refs.length).length, 0);
  if (basisValue === "neighboring-micro-shots" && !durations.some((duration) => duration < .75)) throw new SectionValidationError("structure", "Decline basis lacks neighboring micro-shots.");
  const regionalCandidates = packet.support.filter((item) => item.at >= region.start && item.at < region.end).length;
  if (basisValue === "limited-destination-support" && supported > regionalCandidates * 2) throw new SectionValidationError("structure", "Decline basis conflicts with destination support.");
  if (basisValue === "current-hold-and-user-intent" && (region.current.length !== 1 || !/hold|slow|contemplative|sustain|meditative|deliberate/i.test(JSON.stringify(packet.packet.userIntent)))) throw new SectionValidationError("structure", "Decline basis conflicts with current hold or user intent.");
  if (reasonValue === "pacing-change-would-overcorrect" && basisValue !== "neighboring-micro-shots") throw new SectionValidationError("structure", "Pacing decline requires neighboring micro-shots.");
  if (reasonValue === "candidate-support-too-weak" && basisValue !== "limited-destination-support") throw new SectionValidationError("structure", "Support decline requires limited destination support.");
  if (reasonValue === "current-shot-preferred" && basisValue !== "current-hold-and-user-intent") throw new SectionValidationError("structure", "Current shot preference requires aligned hold intent.");
  return { outcome: "decline", reason: reasonValue as RepairDeclineReason, basis: basisValue as "neighboring-micro-shots" | "limited-destination-support" | "current-hold-and-user-intent" } as Extract<RepairProposal, { outcome: "decline" }>;
}

export function requiredEditorialEffect(code: string): string {
  if (code === "long-stretch") return "meaningfully alter pacing inside the flagged uninterrupted region";
  if (code === "mechanical-alternation") return "break the detected repetitive source pattern";
  if (code === "micro-shot-abuse") return "reduce excessive short-shot concentration";
  return "change the timeline structure relevant to the flagged finding";
}

export function resolveRegionalOperations(response: unknown, packet: ReturnType<typeof buildRegionalRepairPacket>, region: RepairRegion): JsonObject[] {
  if (!response || typeof response !== "object" || Array.isArray(response) || (response as JsonObject).outcome !== "repair" || Object.keys(response).sort().join(",") !== "operations,outcome" || !Array.isArray((response as JsonObject).operations)) throw new SectionValidationError("structure", "Repair response requires outcome=repair and operations only.");
  const operations = (response as { operations: unknown[] }).operations;
  if (!operations.length) throw new SectionValidationError("structure", "Repair contract requires at least one semantic operation; choose repair or constrained decline.");
  if (operations.length > 32) throw new SectionValidationError("structure", "Too many repair operations.");
  const switches = new Map(packet.switches.map((item, index) => [item.id, { at: item.at, clipId: item.clipId, action: region.current[index + 1].action, confidence: region.current[index + 1].confidence, creativeIntent: region.current[index + 1].creativeIntent, evidenceRefs: region.current[index + 1].evidenceRefs }]));
  const used = new Set<string>();
  for (const raw of operations) {
    if (!raw || typeof raw !== "object") throw new SectionValidationError("structure", "Invalid repair operation.");
    const op = raw as JsonObject, operation = op.operation;
    if (!["add-switch", "remove-switch", "move-switch", "replace-destination"].includes(String(operation))) throw new SectionValidationError("structure", "Unsupported repair operation.");
    const allowedFields = new Set(["operation", "existingSwitchId", "candidateId", "destinationClipId", "creativeIntent"]);
    if (Object.keys(op).some((key) => !allowedFields.has(key))) throw new SectionValidationError("structure", "Repair operation contains unsupported fields.");
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
