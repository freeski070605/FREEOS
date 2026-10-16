import type { EditingDecision, JsonObject } from "../planning/plannerTypes";
import { mergeAdjacentDecisions } from "../critique/assembly";
import { critiqueTimeline, type CriticContext, type EditorialFinding } from "../critique/editorialCritic";

export interface RepairRegion { start: number; end: number; finding: EditorialFinding; current: EditingDecision[]; before: EditingDecision[]; after: EditingDecision[] }

export function findRepairRegion(decisions: EditingDecision[], finding: EditorialFinding): RepairRegion {
  const first = Math.max(0, decisions.findIndex((item) => item.end > finding.start + 0.001));
  let last = decisions.findIndex((item, index) => index >= first && item.end >= finding.end - 0.001);
  if (last < first) last = decisions.length - 1;
  // Keep one model packet near a minute. If the finding is longer, later passes handle the remainder.
  while (last > first && decisions[last].end - decisions[first].start > 75) last--;
  const current = decisions.slice(first, last + 1);
  return { start: current[0].start, end: current.at(-1)!.end, finding, current, before: decisions.slice(0, first), after: decisions.slice(last + 1) };
}

export function validateAssembledTimeline(decisions: EditingDecision[], videos: JsonObject[]): void {
  for (let i = 0; i < decisions.length; i++) {
    const item = decisions[i];
    const source = videos.find((video) => String(video.id) === item.clipId);
    if (!source || item.start < Number(source.timelineAvailableStart) - 0.05 || item.end > Number(source.timelineAvailableEnd) + 0.05) throw new Error(`Assembled source availability failure at ${item.start}.`);
    if (item.end <= item.start || (i && Math.abs(decisions[i - 1].end - item.start) > 0.05)) throw new Error(`Assembled timeline continuity failure at ${item.start}.`);
  }
}

export async function runGlobalEditorialRepair(input: {
  decisions: EditingDecision[]; videos: JsonObject[]; candidates: JsonObject[]; boundaries: number[];
  context: CriticContext; maxPasses: number;
  regenerate: (region: RepairRegion, findings: EditorialFinding[], pass: number) => Promise<EditingDecision[]>;
}) {
  const initialCriticFindings = critiqueTimeline(input.decisions, input.videos, input.candidates, input.boundaries, input.context);
  let decisions = input.decisions;
  let findings = initialCriticFindings;
  let globalRepairPasses = 0;
  const attempted = new Set<string>();
  const errors: string[] = [];
  while (globalRepairPasses < input.maxPasses) {
    const target = findings.find((finding) => finding.severity === "material" && !attempted.has(`${finding.code}:${finding.start.toFixed(3)}:${finding.end.toFixed(3)}`));
    if (!target) break;
    const key = `${target.code}:${target.start.toFixed(3)}:${target.end.toFixed(3)}`;
    attempted.add(key);
    globalRepairPasses++;
    const region = findRepairRegion(decisions, target);
    try {
      const replacement = await input.regenerate(region, findings, globalRepairPasses);
      if (!replacement.length || Math.abs(replacement[0].start - region.start) > 0.01 || Math.abs(replacement.at(-1)!.end - region.end) > 0.01) throw new Error("Repair changed regional coverage.");
      if (region.after.length && replacement.at(-1)!.clipId !== region.current.at(-1)!.clipId) throw new Error("Repair changed the camera crossing the regional boundary.");
      const assembled = mergeAdjacentDecisions([...region.before, ...replacement, ...region.after]);
      validateAssembledTimeline(assembled, input.videos);
      decisions = assembled;
      findings = critiqueTimeline(decisions, input.videos, input.candidates, input.boundaries, input.context);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const finalCriticFindings = findings;
  const unresolvedMaterialFindings = findings.filter((finding) => finding.severity === "material" || finding.severity === "invalid");
  const resolvedFindings = initialCriticFindings.filter((initial) => !findings.some((final) => final.code === initial.code && final.start < initial.end && final.end > initial.start));
  return { decisions, initialCriticFindings, globalRepairPasses, resolvedFindings, remainingFindings: findings, finalCriticFindings, unresolvedMaterialFindings, errors };
}
