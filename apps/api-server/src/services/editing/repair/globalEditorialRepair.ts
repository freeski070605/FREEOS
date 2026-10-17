import type { EditingDecision, JsonObject } from "../planning/plannerTypes";
import { mergeAdjacentDecisions } from "../critique/assembly";
import { critiqueTimeline, type CriticContext, type EditorialFinding } from "../critique/editorialCritic";

export interface RepairRegion { start: number; end: number; finding: EditorialFinding; current: EditingDecision[]; before: EditingDecision[]; after: EditingDecision[]; openingClipId: string; priorDecision?: EditingDecision; nextDecision?: EditingDecision; exitClipBeforeRepair: string }
export type RepairDeclineReason = "current-shot-preferred" | "candidate-support-too-weak" | "pacing-change-would-overcorrect";
export type RepairProposal = { outcome: "repair"; operations: JsonObject[]; decisions: EditingDecision[] } |
  { outcome: "decline"; reason: RepairDeclineReason; basis: "neighboring-micro-shots" | "limited-destination-support" | "current-hold-and-user-intent" } |
  { outcome: "decline"; declineReason: RepairDeclineReason; basis: "neighboring-micro-shots" | "limited-destination-support" | "current-hold-and-user-intent" };

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

export function repairEffectPlausible(before: EditingDecision[], after: EditingDecision[], finding: EditorialFinding): boolean {
  const switches = (items: EditingDecision[]) => reconcileRegionalTimeline(items).slice(1)
    .filter((item) => item.start >= finding.start - 0.001 && item.start < finding.end - 0.001)
    .map((item) => [Number(item.start.toFixed(3)), item.clipId]);
  const prior = switches(before), next = switches(after);
  if (finding.code === "long-stretch") return JSON.stringify(prior) !== JSON.stringify(next) && next.length > prior.length;
  if (finding.code === "micro-shot-abuse") {
    const shortCount = (items: EditingDecision[]) => reconcileRegionalTimeline(items)
      .filter((item) => item.start < finding.end && item.end > finding.start && item.end - item.start < 0.75).length;
    return shortCount(after) < shortCount(before) || next.length < prior.length;
  }
  if (finding.code === "mechanical-alternation") return JSON.stringify(prior) !== JSON.stringify(next);
  return JSON.stringify(prior) !== JSON.stringify(next);
}

export async function runGlobalEditorialRepair(input: {
  decisions: EditingDecision[]; videos: JsonObject[]; candidates: JsonObject[]; boundaries: number[];
  context: CriticContext; maxPasses: number;
  regenerate: (region: RepairRegion, findings: EditorialFinding[], pass: number, reportModelAttempt: () => void, noOpRetry?: boolean) => Promise<RepairProposal>;
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
  let globalRepairNoOpRetries = 0;
  let globalRepairNoOpDeclines = 0;
  let globalRepairCreativeNonConvergence = 0;
  let globalRepairRepairOutcomes = 0, globalRepairDeclineOutcomes = 0, globalRepairContractFailures = 0;
  let globalRepairIneffectiveProposals = 0, globalRepairEffectCheckFailures = 0;
  const regionLogs: JsonObject[] = [];
  const attempted = new Set<string>();
  const regionAttemptCount = new Map<string, number>();
  let totalRegionAttempts = 0;
  const errors: string[] = [];
  const infrastructureFailures: string[] = [];
  const editorialLimitations: string[] = [];
  const creativeNonConvergence: string[] = [];
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
    const neighboringDurations = { previous: region.before.slice(-3).map((d) => Number((d.end - d.start).toFixed(3))),
      current: region.current.map((d) => Number((d.end - d.start).toFixed(3))), next: region.after.slice(0, 3).map((d) => Number((d.end - d.start).toFixed(3))) };
    const supportedDestinationCount = regionalSupport.reduce((sum, candidate) => sum + Object.values(candidate.targetSupport).filter((refs) => refs.length).length, 0);
    const regionLog: JsonObject = { regionStart: region.start, regionEnd: region.end, openingClipId: region.openingClipId,
      exitClipBeforeRepair: region.exitClipBeforeRepair, candidateCount: input.candidates.filter((candidate) => Number(candidate.at) >= region.start && Number(candidate.at) < region.end).length,
      viableCandidateCount, supportedDestinationCount, repairRegionNeighborShotDurations: neighboringDurations,
      switchesBefore: Math.max(0, region.current.length - 1), switchesAfter: Math.max(0, region.current.length - 1), repairApplied: false,
      requestedFindingCode: region.finding.code, requiredEditorialEffect: region.finding.code === "long-stretch" ? "meaningfully alter pacing inside the flagged uninterrupted region" : region.finding.code === "mechanical-alternation" ? "break the detected repetitive source pattern" : region.finding.code === "micro-shot-abuse" ? "reduce excessive short-shot concentration" : "change the timeline structure relevant to the flagged finding",
      modelOutcome: null, operationCount: 0, semanticTimelineChanged: false, declineReason: null, criticFindingAfterRepair: null };
    regionLogs.push(regionLog);
    if (input.context.candidateSupport !== undefined && !viableCandidateCount && region.current.length === 1) {
      const message = `editorial-limitation: no viable supported alternate camera in region ${region.start}-${region.end}.`;
      editorialLimitations.push(message); errors.push(message);
      regionLog.failureKind = "editorial-limitation";
      continue;
    }
    try {
      let replacement: RepairProposal = await input.regenerate(region, findings, totalRegionAttempts, () => { globalRepairModelAttempts++; });
      for (let retry = 0; retry <= 1; retry++) {
        regionLog.modelOutcome = replacement.outcome;
        if (replacement.outcome === "decline") {
          const declineReason = "reason" in replacement ? replacement.reason : replacement.declineReason;
          globalRepairDeclineOutcomes++;
          globalRepairNoOpDeclines++;
          regionLog.declineReason = declineReason;
          regionLog.declineBasis = replacement.basis;
          // A decline is advice; the critic's material finding remains in force.
          const energeticIntent = /more cuts|substantially more|visual energy|faster pac|high.energy|dynamic|energetic|punchier|more visual variety/i.test(JSON.stringify(input.context.userIntent ?? ""));
          const credibleLimitation = !energeticIntent && (replacement.basis === "limited-destination-support" && viableCandidateCount === 0 ||
            replacement.basis === "neighboring-micro-shots" && neighboringDurations.previous.concat(neighboringDurations.next).some((duration) => duration < .75) && viableCandidateCount === 0);
          if (viableCandidateCount > 0 && !credibleLimitation) {
            const message = `creative-nonconvergence: grounded decline leaves ${region.finding.code} unresolved in region ${region.start}-${region.end}.`;
            creativeNonConvergence.push(message); regionLog.failureKind = "creative-nonconvergence";
          } else {
            editorialLimitations.push(`editorial-limitation: supported repair options do not resolve ${region.finding.code} in region ${region.start}-${region.end}.`);
            regionLog.failureKind = "editorial-limitation";
          }
          break;
        }
        globalRepairRepairOutcomes++;
        regionLog.operationCount = replacement.operations.length;
        const repaired = replacement.decisions;
        if (!replacement.operations.length || !repaired.length) throw new Error("repair-contract: semantic operation and regional coverage required.");
        if (Math.abs(repaired[0].start - region.start) > 0.01 || Math.abs(repaired.at(-1)!.end - region.end) > 0.01) throw new Error("Repair changed regional coverage.");
        const assembled = reconcileRegionalTimeline([...region.before, ...repaired, ...region.after]);
        validateAssembledTimeline(assembled, input.videos);
        // A downstream decision that becomes a same-camera handoff is normalized by assembly.
        const changed = semanticTimeline(assembled) !== semanticTimeline(decisions);
        regionLog.switchesAfter = Math.max(0, repaired.length - 1);
        regionLog.semanticTimelineChanged = changed;
        const effect = changed && repairEffectPlausible(decisions, assembled, region.finding);
        if (!effect) {
          globalRepairIneffectiveProposals++;
          if (changed) globalRepairEffectCheckFailures++;
          globalRepairNoOpProposals++; regionLog.noOp = true;
          if (viableCandidateCount > 0 && retry === 0) {
            globalRepairNoOpRetries++;
            replacement = await input.regenerate(region, findings, totalRegionAttempts, () => { globalRepairModelAttempts++; }, true);
            continue;
          }
          const message = viableCandidateCount > 0
            ? `creative-nonconvergence: repair proposals did not affect ${region.finding.code} in region ${region.start}-${region.end}.`
            : `editorial-limitation: no viable supported alternative in region ${region.start}-${region.end}.`;
          if (viableCandidateCount > 0) { creativeNonConvergence.push(message); regionLog.failureKind = "creative-nonconvergence"; }
          else { editorialLimitations.push(message); regionLog.failureKind = "editorial-limitation"; }
          break;
        }
        decisions = assembled;
        globalRepairAppliedPasses++;
        globalRepairPasses = globalRepairAppliedPasses;
        regionLog.repairApplied = true;
        findings = critiqueTimeline(decisions, input.videos, input.candidates, input.boundaries, input.context);
        regionLog.criticFindingAfterRepair = findings.some((finding) => finding.code === region.finding.code && finding.start < region.finding.end && finding.end > region.finding.start);
        globalRepairCritiquePasses++;
        attempted.clear();
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const contract = /repair-contract:|Repair contract|Repair response requires|Repair decline requires|Unsupported repair decline|Unsupported repair operation/i.test(message);
      if (contract) globalRepairContractFailures++;
      const infrastructure = !contract && !message.startsWith("editorial-limitation:");
      if (contract) { creativeNonConvergence.push(`creative-nonconvergence: ${message}`); regionLog.failureKind = "creative-nonconvergence"; errors.push(message); continue; }
      if (infrastructure) infrastructureFailures.push(message);
      else editorialLimitations.push(message);
      regionLog.failureKind = infrastructure ? "repair-infrastructure" : "editorial-limitation";
      if (!message.startsWith("global-repair-context-budget")) globalRepairValidationFailures++;
      errors.push(message);
    }
  }
  const finalCriticFindings = findings;
  const unresolvedMaterialFindings = findings.filter((finding) => finding.severity === "material" || finding.severity === "invalid");
  if (unresolvedMaterialFindings.length && !infrastructureFailures.length && !editorialLimitations.length && !creativeNonConvergence.length && globalRepairAppliedPasses)
    editorialLimitations.push("Valid global repair opportunities were attempted, but material critic findings remain.");
  const resolvedFindings = initialCriticFindings.filter((initial) => !findings.some((final) => final.code === initial.code && final.start < initial.end && final.end > initial.start));
  globalRepairCreativeNonConvergence = creativeNonConvergence.length;
  return { decisions, initialCriticFindings, globalRepairPasses, globalRepairModelAttempts, globalRepairValidationFailures, globalRepairNoOpProposals, globalRepairNoOpRetries, globalRepairNoOpDeclines, globalRepairCreativeNonConvergence,
    globalRepairRepairOutcomes, globalRepairDeclineOutcomes, globalRepairContractFailures, globalRepairIneffectiveProposals, globalRepairEffectCheckFailures,
    globalRepairAppliedPasses, globalRepairCritiquePasses, globalRepairMergedRegions, regionLogs,
    resolvedFindings, remainingFindings: findings, finalCriticFindings, unresolvedMaterialFindings, errors, infrastructureFailures, editorialLimitations, creativeNonConvergence };
}
