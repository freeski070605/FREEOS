import type { JsonObject } from "../planning/plannerTypes";
import { number } from "../shared";
import type { EvidenceRecord } from "./evidenceRefs";

export const switchLocalitySeconds = 0.8;
export const targetVisualTypes = new Set<EvidenceRecord["type"]>([
  "scene-change", "motion-shift", "motion-state", "camera-motion",
  "framing", "face-presence", "sharpness", "exposure",
]);

export function isLocalSwitchEvidence(record: EvidenceRecord, at: number): boolean {
  return !record.opening && Math.abs(record.at - at) <= switchLocalitySeconds;
}

export function availableClipIdsAt(videos: JsonObject[], at: number): string[] {
  return videos.filter((video) => number(video.timelineAvailableStart, 0) <= at + 0.001 &&
    number(video.timelineAvailableEnd, 0) > at + 0.001).map((video) => String(video.id));
}

export function targetSupportRefs(catalog: EvidenceRecord[], videos: JsonObject[], at: number, clipId: string): string[] {
  const available = availableClipIdsAt(videos, at);
  if (!available.includes(clipId)) return [];
  return catalog.filter((record) => record.clipId === clipId && isLocalSwitchEvidence(record, at) &&
    (available.length === 1 ? record.type === "source-availability" || targetVisualTypes.has(record.type) : targetVisualTypes.has(record.type)))
    .map((record) => record.id);
}

export function buildCandidateSupportIndex(candidates: JsonObject[], catalog: EvidenceRecord[], videos: JsonObject[]) {
  return candidates.map((candidate, index) => {
    const at = number(candidate.at, NaN);
    const availableClips = availableClipIdsAt(videos, at);
    const targetSupport = Object.fromEntries(availableClips.map((clipId) => [clipId, targetSupportRefs(catalog, videos, at, clipId)]));
    return { candidateId: `c${index + 1}`, at, availableClips, targetSupport };
  });
}
