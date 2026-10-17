import type { EditingDecision, JsonObject } from "../planning/plannerTypes";
import { mergeAdjacentDecisions } from "../critique/assembly";
import { critiqueTimeline, type CriticContext, type EditorialFinding } from "../critique/editorialCritic";

export interface RepairRegion { start: number; end: number; finding: EditorialFinding; current: EditingDecision[]; before: EditingDecision[]; after: EditingDecision[]; openingClipId: string; priorDecision?: EditingDecision; nextDecision?: EditingDecision; exitClipBeforeRepair: string }

export function normalizeRegionalSwitches(switches: unknown[], start: number, openingClipId: string): { switches: unknown[]; boundaryNoOpsRemoved: number } {
  let boundaryNoOpsRemoved = 0;
  const normalized = switches.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const switchItem = item as JsonObject;
    const isNoOp = typeof switchItem.at === "number" && Math.abs(switchItem.at - start) <= 0.001 && switchItem.clipId === openingClipId;
    if (isNoOp) boundaryNoOpsRemoved++;
    return !isNoOp;
  });
  return { switches: normalized, boundaryNoOpsRemoved };
}

export function findRepairRegion(decisions: EditingDecision[], finding: EditorialFinding): RepairRegion {
  const first = Math.max(0, decisions.findIndex((item) => item.end > finding.start + 0.001));
  let last = decisions.findIndex((item, index) => index >= first && item.end >= finding.end - 0.001);
  if (last < first) last = decisions.length - 1;
  // Keep one model packet near a minute. If the finding is longer, later passes handle the remainder.
  while (last > first && decisions[last].end - decisions[first].start > 75) last--;
  const current = decisions.slice(first, last + 1);
  const before = decisions.slice(0, first);
  const after = decisions.slice(last + 1);
  return { start: current[0].start, end: current.at(-1)!.end, finding, current, before, after,
    openingClipId: current[0].clipId, priorDecision: before.at(-1), nextDecision: after[0], exitClipBeforeRepair: current.at(-1)!.clipId };
}

export function validateAssembledTimeline(decisions: EditingDecision[], videos: JsonObject[]): void {
  for (let i = 0; i < decisions.length; i++) {
    const item = decisions[i];
    const source = videos.find((video) => String(video.id) === item.clipId);
    if (!source || item.start < Number(source.timelineAvailableStart) - 0.05 || item.end > Number(source.timelineAvailableEnd) + 0.05) throw new Error(`Assembled source availability failure at ${item.start}.`);
    if (item.end <= item.start || (i && Math.abs(decisions[i - 1].end - item.start) > 0.05)) throw new Error(`Assembled timeline continuity failure at ${item.start}.`);
  }
}

export function reconcileRegionalTimeline(decisions: EditingDecision[]): EditingDecision[] {
  const merged = mergeAdjacentDecisions(decisions);
  const result: EditingDecision[] = [];
  for (const decision of merged) {
    const previous = result.at(-1);
    if (previous && previous.clipId === decision.clipId && previous.action !== "punch-in" && decision.action !== "punch-in" &&
      Math.abs(previous.end - decision.start) <= 0.02) {
      previous.end = decision.end;
      previous.confidence = Math.min(previous.confidence, decision.confidence);
    } else result.push({ ...decision });
  }
  return result;
}

export async function runGlobalEditorialRepair(input: {
  decisions: EditingDecision[]; videos: JsonObject[]; candidates: JsonObject[]; boundaries: number[];
  context: CriticContext; maxPasses: number;
  regenerate: (region: RepairRegion, findings: EditorialFinding[], pass: number, reportModelAttempt: () => void) => Promise<EditingDecision[]>;
}) {
  const initialCriticFindings = critiqueTimeline(input.decisions, input.videos, input.candidates, input.boundaries, input.context);
  let decisions = input.decisions;
  let findings = initialCriticFindings;
  let globalRepairPasses = 0;
  let globalRepairModelAttempts = 0;
  let globalRepairValidationFailures = 0;
  let globalRepairAppliedPasses = 0;
  let globalRepairCritiquePasses = 0;
  let globalRepairMergedRegions = 0;
  const regionLogs: JsonObject[] = [];
  const attempted = new Set<string>();
  const failedRegions = new Set<string>();
  const errors: string[] = [];
  const infrastructureFailures: string[] = [];
  const editorialLimitations: string[] = [];
  while (globalRepairPasses < input.maxPasses) {
    const target = findings.find((finding) => (finding.severity === "material" || finding.severity === "invalid") && !attempted.has(`${finding.code}:${finding.start.toFixed(3)}:${finding.end.toFixed(3)}`));
    if (!target) break;
    const key = `${target.code}:${target.start.toFixed(3)}:${target.end.toFixed(3)}`;
    attempted.add(key);
    const overlapping = findings.filter((finding) => (finding.severity === "material" || finding.severity === "invalid") && finding.start < target.end && finding.end > target.start);
    globalRepairMergedRegions += Math.max(0, overlapping.length - 1);
    const mergedFinding = overlapping.length > 1 ? { ...target,
      start: Math.min(...overlapping.map((finding) => finding.start)), end: Math.max(...overlapping.map((finding) => finding.end)) } : target;
    const region = findRepairRegion(decisions, mergedFinding);
    const regionKey = `${region.start.toFixed(3)}:${region.end.toFixed(3)}`;
    if (failedRegions.has(regionKey)) continue;
    globalRepairPasses++;
    const regionalSupport = input.context.candidateSupport?.filter((candidate) => candidate.at >= region.start && candidate.at < region.end) ?? [];
    const viableCandidateCount = regionalSupport.filter((candidate) => {
      const active = region.current.find((decision) => decision.start <= candidate.at && decision.end > candidate.at)?.clipId;
      return Object.entries(candidate.targetSupport).some(([clipId, refs]) => clipId !== active && refs.length > 0);
    }).length;
    const regionLog: JsonObject = { regionStart: region.start, regionEnd: region.end, openingClipId: region.openingClipId,
      exitClipBeforeRepair: region.exitClipBeforeRepair, candidateCount: input.candidates.filter((candidate) => Number(candidate.at) >= region.start && Number(candidate.at) < region.end).length,
      viableCandidateCount, supportedDestinationCount: regionalSupport.reduce((sum, candidate) => sum + Object.values(candidate.targetSupport).filter((refs) => refs.length).length, 0),
      switchesBefore: Math.max(0, region.current.length - 1), switchesAfter: Math.max(0, region.current.length - 1), repairApplied: false };
    regionLogs.push(regionLog);
    if (input.context.candidateSupport !== undefined && !viableCandidateCount && region.current.length === 1) {
      const message = `editorial-limitation: no viable supported alternate camera in region ${region.start}-${region.end}.`;
      editorialLimitations.push(message); errors.push(message); failedRegions.add(regionKey);
      regionLog.failureKind = "editorial-limitation";
      continue;
    }
    try {
      const replacement = await input.regenerate(region, findings, globalRepairPasses, () => { globalRepairModelAttempts++; });
      if (!replacement.length || Math.abs(replacement[0].start - region.start) > 0.01 || Math.abs(replacement.at(-1)!.end - region.end) > 0.01) throw new Error("Repair changed regional coverage.");
      const assembled = reconcileRegionalTimeline([...region.before, ...replacement, ...region.after]);
      validateAssembledTimeline(assembled, input.videos);
      // A downstream decision that becomes a same-camera handoff is normalized by assembly.
      const changed = JSON.stringify(assembled.map((item) => [item.start, item.end, item.clipId])) !== JSON.stringify(decisions.map((item) => [item.start, item.end, item.clipId]));
      decisions = assembled;
      globalRepairAppliedPasses++;
      regionLog.switchesAfter = Math.max(0, replacement.length - 1);
      regionLog.repairApplied = true;
      findings = critiqueTimeline(decisions, input.videos, input.candidates, input.boundaries, input.context);
      globalRepairCritiquePasses++;
      // Every subsequent region is selected from the newly accepted timeline and fresh critique.
      if (changed) { attempted.clear(); failedRegions.clear(); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const infrastructure = /^(?:global-repair-context-budget|context-budget|structure|target-grounding|invalid-evidence-reference|non-local-evidence|missing-evidence-reference|unsupported-creative-intent|repair parser|plan repair failed)/i.test(message);
      if (infrastructure) infrastructureFailures.push(message);
      else editorialLimitations.push(message);
      regionLog.failureKind = infrastructure ? "repair-infrastructure" : "editorial-limitation";
      if (!message.startsWith("global-repair-context-budget")) globalRepairValidationFailures++;
      failedRegions.add(regionKey);
      errors.push(message);
    }
  }
  const finalCriticFindings = findings;
  const unresolvedMaterialFindings = findings.filter((finding) => finding.severity === "material" || finding.severity === "invalid");
  const resolvedFindings = initialCriticFindings.filter((initial) => !findings.some((final) => final.code === initial.code && final.start < initial.end && final.end > initial.start));
  return { decisions, initialCriticFindings, globalRepairPasses, globalRepairModelAttempts, globalRepairValidationFailures,
    globalRepairAppliedPasses, globalRepairCritiquePasses, globalRepairMergedRegions, regionLogs,
    resolvedFindings, remainingFindings: findings, finalCriticFindings, unresolvedMaterialFindings, errors, infrastructureFailures, editorialLimitations };
}
