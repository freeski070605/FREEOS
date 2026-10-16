import type { JsonObject } from "../planning/plannerTypes";
import { number } from "../shared";
import { availableOpeningClips } from "../planning/openingState";
import type { EvidenceRecord } from "./evidenceRefs";

export interface OpeningEvidenceScope { start: number; end: number; availableClipIds: string[] }

// Two seconds is an absolute ceiling. The actual scope follows the analyzer's
// first valid sample and cadence; delayed or absent samples remain absent.
export function resolveOpeningEvidenceScope(videos: JsonObject[], timelineStart = 0): OpeningEvidenceScope {
  const availableClipIds = availableOpeningClips(videos, timelineStart);
  const firstTimes: number[] = [];
  const cadences: number[] = [];
  for (const video of videos) {
    if (!availableClipIds.includes(String(video.id))) continue;
    const measurements = Array.isArray(video.openingMeasurements) ? video.openingMeasurements as JsonObject[] : [];
    // Each normalized record is the first valid sample for one metric. Include
    // delayed first face/framing/motion readings even if another metric starts at zero.
    const first = Math.max(...measurements.map((item) => number(item.at, NaN)).filter((at) => Number.isFinite(at) && at >= timelineStart && at <= timelineStart + 2));
    if (Number.isFinite(first)) firstTimes.push(first);
    const cadence = number(video.sampleCadence, NaN);
    if (Number.isFinite(cadence) && cadence > 0) cadences.push(cadence);
  }
  const cadence = cadences.length ? Math.max(...cadences) : 0.5;
  const lastFirst = firstTimes.length ? Math.max(...firstTimes) : timelineStart;
  return { start: timelineStart, end: Math.min(timelineStart + 2, Math.max(timelineStart + 0.8, lastFirst + cadence)), availableClipIds };
}

export function openingEvidenceByClip(videos: JsonObject[], catalog: EvidenceRecord[], scope: OpeningEvidenceScope) {
  return scope.availableClipIds.map((clipId) => {
    const records = catalog.filter((item) => item.clipId === clipId && item.at >= scope.start && item.at <= scope.end && (item.opening || item.type === "source-availability"));
    const types = new Set(records.map((record) => record.type));
    const video = videos.find((item) => String(item.id) === clipId);
    const firstMeasurementAt = Math.min(...(Array.isArray(video?.openingMeasurements) ? (video.openingMeasurements as JsonObject[]).map((item) => number(item.at, Infinity)).filter((at) => at >= scope.start && at <= scope.end) : []));
    return { clipId, sourceAvailable: true, evidenceRefs: records.map((item) => item.id),
      evidence: records.map((item) => ({ id: item.id, type: item.type, at: item.at,
        ...(item.value !== undefined ? { value: item.value } : {}), ...(item.label ? { label: item.label } : {}) })),
      missing: ["framing", "face-presence", "motion-state", "sharpness", "exposure", "camera-motion"].filter((type) => !types.has(type as EvidenceRecord["type"])),
      firstMeasurementAt: Number.isFinite(firstMeasurementAt) ? firstMeasurementAt : null };
  });
}
