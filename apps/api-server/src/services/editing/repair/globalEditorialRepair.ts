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

export function buildMaterialRepairRegions(decisions: EditingDecision[], findings: EditorialFinding[]): Array<{ finding: EditorialFinding; members: EditorialFinding[]; region: RepairRegion }> {
  const material = findings.filter((item) => item.severity === "material" || item.severity === "invalid");
  const groups: EditorialFinding[][] = [];
  for (const finding of material.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const group = groups.find((members) => members.some((other) => {
      const overlap = Math.min(other.end, finding.end) - Math.max(other.start, finding.start);
      const smaller = Math.min(other.end - other.start, finding.end - finding.start);
      return overlap > 0 && overlap >= Math.min(2, smaller * 0.25) &&
        (other.code === finding.code || Math.max(other.end - other.start, finding.end - finding.start) <= 3 * Math.max(0.001, smaller));
    }));
    if (group) group.push(finding); else groups.push([finding]);
  }
  return groups.map((members) => {
    const primary = [...members].sort((a, b) => Number(b.severity === "invalid") - Number(a.severity === "invalid") || (b.end - b.start) - (a.end - a.start))[0];
    const finding = { ...primary, start: Math.min(...members.map((item) => item.start)), end: Math.max(...members.map((item) => item.end)) };
    return { finding, members, region: findRepairRegion(decisions, finding) };
  });
}

function semanticTimeline(decisions: EditingDecision[]): string {
  return JSON.stringify(reconcileRegionalTimeline(decisions).map((item) => [Number(item.start.toFixed(3)), Number(item.end.toFixed(3)), item.clipId, item.action === "punch-in" ? item.action : "cut"]));
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
  let globalRepairNoOpProposals = 0;
  const regionLogs: JsonObject[] = [];
  const attempted = new Set<string>();
  const regionAttemptCount = new Map<string, number>();
  let totalRegionAttempts = 0;
  const errors: string[] = [];
  const infrastructureFailures: string[] = [];
  const editorialLimitations: string[] = [];
  while (globalRepairAppliedPasses < input.maxPasses && totalRegionAttempts < input.maxPasses * 3) {
    const regions = buildMaterialRepairRegions(decisions, findings);
    const ranked = regions.map((item) => {
      const key = `${item.region.start.toFixed(3)}:${item.region.end.toFixed(3)}`;
      const opportunities = input.context.candidateSupport?.filter((candidate) => candidate.at >= item.region.start && candidate.at < item.region.end &&
        Object.entries(candidate.targetSupport).some(([clip, refs]) => refs.length && clip !== item.region.current.find((decision) => decision.start <= candidate.at && decision.end > candidate.at)?.clipId)).length ?? 0;
      const score = (item.members.some((finding) => finding.severity === "invalid") ? 100 : 50) +
        Math.min(30, item.region.end - item.region.start) + Math.min(20, opportunities * 2) + item.members.length * 3 - (regionAttemptCount.get(key) ?? 0) * 100;
      return { ...item, key, score };
    }).filter((item) => !attempted.has(item.key)).sort((a, b) => b.score - a.score || a.region.start - b.region.start);
    const target = ranked[0];
    if (!target) break;
    const region = target.region;
    attempted.add(target.key);
    regionAttemptCount.set(target.key, (regionAttemptCount.get(target.key) ?? 0) + 1);
    totalRegionAttempts++;
    globalRepairMergedRegions += Math.max(0, target.members.length - 1);
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
      editorialLimitations.push(message); errors.push(message);
      regionLog.failureKind = "editorial-limitation";
      continue;
    }
    try {
      const replacement = await input.regenerate(region, findings, totalRegionAttempts, () => { globalRepairModelAttempts++; });
      if (!replacement.length || Math.abs(replacement[0].start - region.start) > 0.01 || Math.abs(replacement.at(-1)!.end - region.end) > 0.01) throw new Error("Repair changed regional coverage.");
      const assembled = reconcileRegionalTimeline([...region.before, ...replacement, ...region.after]);
      validateAssembledTimeline(assembled, input.videos);
      // A downstream decision that becomes a same-camera handoff is normalized by assembly.
      const changed = semanticTimeline(assembled) !== semanticTimeline(decisions);
      regionLog.switchesAfter = Math.max(0, replacement.length - 1);
      if (!changed) { globalRepairNoOpProposals++; regionLog.noOp = true; continue; }
      decisions = assembled;
      globalRepairAppliedPasses++;
      globalRepairPasses = globalRepairAppliedPasses;
      regionLog.repairApplied = true;
      findings = critiqueTimeline(decisions, input.videos, input.candidates, input.boundaries, input.context);
      globalRepairCritiquePasses++;
      attempted.clear();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const infrastructure = !message.startsWith("editorial-limitation:");
      if (infrastructure) infrastructureFailures.push(message);
      else editorialLimitations.push(message);
      regionLog.failureKind = infrastructure ? "repair-infrastructure" : "editorial-limitation";
      if (!message.startsWith("global-repair-context-budget")) globalRepairValidationFailures++;
      errors.push(message);
    }
  }
  const finalCriticFindings = findings;
  const unresolvedMaterialFindings = findings.filter((finding) => finding.severity === "material" || finding.severity === "invalid");
  if (unresolvedMaterialFindings.length && !infrastructureFailures.length && !editorialLimitations.length && (globalRepairAppliedPasses || globalRepairNoOpProposals))
    editorialLimitations.push("Valid global repair opportunities were attempted, but material critic findings remain.");
  const resolvedFindings = initialCriticFindings.filter((initial) => !findings.some((final) => final.code === initial.code && final.start < initial.end && final.end > initial.start));
  return { decisions, initialCriticFindings, globalRepairPasses, globalRepairModelAttempts, globalRepairValidationFailures, globalRepairNoOpProposals,
    globalRepairAppliedPasses, globalRepairCritiquePasses, globalRepairMergedRegions, regionLogs,
    resolvedFindings, remainingFindings: findings, finalCriticFindings, unresolvedMaterialFindings, errors, infrastructureFailures, editorialLimitations };
}
