import type { EditingDecision, JsonObject } from "../planning/plannerTypes";
import { number } from "../shared";
export function appendSectionDecisions(decisions: EditingDecision[], section: EditingDecision[]): void {
  const previous = decisions.at(-1);
  const first = section[0];
  if (previous && first && previous.clipId === first.clipId && Math.abs(previous.end - first.start) <= 0.001) {
    previous.end = first.end;
    decisions.push(...section.slice(1));
  } else decisions.push(...section);
}
export function mergeAdjacentDecisions(decisions: EditingDecision[], tolerance = 0.02): EditingDecision[] {
  const merged: EditingDecision[] = [];
  for (const decision of decisions) {
    const previous = merged.at(-1);
    if (previous && previous.clipId === decision.clipId && previous.action === decision.action && Math.abs(previous.end - decision.start) <= tolerance) {
      previous.end = decision.end;
      previous.confidence = Math.min(previous.confidence, decision.confidence);
      if (!previous.rationale && decision.rationale) previous.rationale = decision.rationale;
    } else merged.push({ ...decision });
  }
  return merged;
}
export function assertNonDegenerateAssembly(reviewed: EditingDecision[], draft: EditingDecision[]): void {
  if (!reviewed.length || !draft.length) return;
  const reviewedStart = reviewed[0].start;
  const reviewedEnd = reviewed.at(-1)?.end ?? reviewedStart;
  const reviewedDuration = Math.max(0.001, reviewedEnd - reviewedStart);
  const draftStart = draft[0].start;
  const draftEnd = draft.at(-1)?.end ?? draftStart;
  const draftDuration = Math.max(0.001, draftEnd - draftStart);

  const coverage = (items: EditingDecision[]) => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.clipId, (map.get(item.clipId) ?? 0) + Math.max(0, item.end - item.start));
    return map;
  };

  const reviewedCoverage = coverage(reviewed);
  const draftCoverage = coverage(draft);
  const reviewedDominant = Math.max(...reviewedCoverage.values()) / reviewedDuration;
  const draftDominant = Math.max(...draftCoverage.values()) / draftDuration;
  const reviewedUnique = reviewedCoverage.size;
  const draftUnique = draftCoverage.size;

  const severeDominance = reviewedDominant >= 0.88 && reviewedDominant >= draftDominant + 0.18;
  const severeVarietyCollapse = draftUnique >= 4 && reviewedUnique <= 2 && reviewed.length <= 4;

  if (severeDominance || severeVarietyCollapse) {
    throw new Error(`Global assembly review over-collapsed the staged edit (dominantShare=${reviewedDominant.toFixed(3)}, draftDominantShare=${draftDominant.toFixed(3)}, reviewedCameras=${reviewedUnique}, draftCameras=${draftUnique}, reviewedSegments=${reviewed.length}). Preserve motivated camera variety while removing only unsupported boundary artifacts.`);
  }
}
export function buildGroundedCautions(videos: JsonObject[], duration: number, availableEnd: number): string[] {
  const cautions: string[] = [];
  for (const video of videos) {
    const id = String(video.id);
    const flags = Array.isArray(video.qualityFlags) ? video.qualityFlags as JsonObject[] : [];
    const kinds = Array.from(new Set(flags.map((flag) => typeof flag.kind === "string" ? flag.kind : "").filter(Boolean)));
    if (kinds.length) cautions.push(`${id}: measured source-quality flags include ${kinds.join(", ")}.`);
    const notes = Array.isArray(video.semanticNotes) ? video.semanticNotes.filter((v): v is string => typeof v === "string").slice(0, 2) : [];
    for (const note of notes) cautions.push(`${id}: analyzer note â€” ${note}`);
  }
  if (availableEnd < duration - 0.05) {
    cautions.push(`No supplied video source covers the final ${(duration - availableEnd).toFixed(2)} seconds of the requested duration; FREEOS did not invent coverage.`);
  }
  return Array.from(new Set(cautions)).slice(0, 50);
}
