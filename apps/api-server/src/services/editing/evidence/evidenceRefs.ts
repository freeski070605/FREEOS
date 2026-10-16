import type { JsonObject } from "../planning/plannerTypes";
import { number } from "../shared";

export const creativeIntents = ["continuity", "visual-contrast", "framing-change", "motion-change", "rhythmic-response", "spatial-reset", "detail-emphasis", "hold-strong-shot"] as const;
export type CreativeIntent = typeof creativeIntents[number];
export type EvidenceType = "audio-transient" | "audio-energy" | "silence-boundary" | "audio-section-boundary" | "scene-change" | "motion-shift" | "camera-motion" | "framing" | "face-presence" | "sharpness" | "exposure" | "semantic-confidence" | "source-availability";
export interface EvidenceRecord { id: string; type: EvidenceType; at: number; clipId?: string; value?: number; label?: string; windowStart?: number; windowEnd?: number }

function boundaries(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (typeof item === "number") return [item];
    if (!item || typeof item !== "object") return [];
    const object = item as JsonObject;
    return ["time", "start", "end", "startTime", "endTime", "startSeconds", "endSeconds"]
      .map((key) => number(object[key], NaN)).filter(Number.isFinite);
  });
}

export function buildEvidenceCatalog(audio: JsonObject, videos: JsonObject[], sectionStart: number, sectionEnd: number, candidateTimes: number[]): EvidenceRecord[] {
  const points = Array.from(new Set([sectionStart, ...candidateTimes])).filter((at) => at >= sectionStart && at < sectionEnd);
  const records: Omit<EvidenceRecord, "id">[] = [];
  const add = (record: Omit<EvidenceRecord, "id">) => {
    if (Number.isFinite(record.at) && points.some((at) => Math.abs(record.at - at) <= 0.8)) records.push(record);
  };
  const transients = Array.isArray(audio.transientMoments) ? audio.transientMoments as JsonObject[] : [];
  for (const item of transients) add({ type: "audio-transient", at: number(item.time, NaN), value: number(item.strength, NaN) });
  for (const at of boundaries(audio.silenceRegions)) add({ type: "silence-boundary", at });
  for (const at of boundaries(audio.sections)) add({ type: "audio-section-boundary", at });
  const audioWindows = Array.isArray(audio.windows) ? audio.windows as JsonObject[] : [];
  for (const at of points) {
    const window = audioWindows.find((w) => number(w.start, NaN) <= at && number(w.end, NaN) > at);
    if (window && Number.isFinite(number(window.energyMean, NaN))) add({ type: "audio-energy", at, value: number(window.energyMean, NaN), windowStart: number(window.start, NaN), windowEnd: number(window.end, NaN) });
  }
  for (const video of videos) {
    const clipId = String(video.id);
    const availableStart = number(video.timelineAvailableStart, NaN);
    const availableEnd = number(video.timelineAvailableEnd, NaN);
    const editMoments = Array.isArray(video.editMoments) ? video.editMoments as JsonObject[] : [];
    for (const item of editMoments) {
      if (item.type === "scene-change" || item.type === "motion-shift") add({ type: item.type, at: number(item.time, NaN), clipId, value: number(item.strength, NaN) });
    }
    const windows = Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
    for (const at of points) {
      if (at < availableStart - 0.01 || at >= availableEnd - 0.01) continue;
      add({ type: "source-availability", at, clipId });
      const window = windows.find((w) => number(w.timelineStart, NaN) <= at && number(w.timelineEnd, NaN) > at);
      if (!window) continue;
      const windowStart = number(window.timelineStart, NaN), windowEnd = number(window.timelineEnd, NaN);
      const metric = (type: EvidenceType, value: unknown) => {
        const measured = number(value, NaN);
        if (Number.isFinite(measured)) add({ type, at, clipId, value: measured, windowStart, windowEnd });
      };
      metric("face-presence", window.facePresence);
      metric("camera-motion", window.globalMotion);
      metric("sharpness", window.sharpness);
      metric("exposure", window.brightness);
      metric("semantic-confidence", window.framingRoleConfidence);
      const label = typeof window.framingRole === "string" && window.framingRole ? window.framingRole : typeof window.shotScale === "string" ? window.shotScale : "";
      if (/^(?:wide|medium|close|tight|long|full|mid|unknown)(?:[ -](?:shot|up|view))?$/i.test(label)) add({ type: "framing", at, clipId, label: label.toLowerCase(), windowStart, windowEnd });
    }
  }
  return records.filter((record) => record.type === "source-availability" || record.type === "audio-energy" || record.type === "framing" || record.value === undefined || Number.isFinite(record.value))
    .map((record, index) => ({ id: `e${index + 1}`, ...record }));
}

export function renderEvidenceRationale(records: EvidenceRecord[]): string {
  return records.map((record) => {
    const at = `${record.at.toFixed(3)}s`;
    const clip = record.clipId ? `Clip ${record.clipId}` : "Audio";
    const value = record.value === undefined ? "" : ` ${Number(record.value.toFixed(3))}`;
    switch (record.type) {
      case "audio-transient": return `Audio transient at ${at}${value ? ` with measured strength${value}` : ""}`;
      case "audio-energy": return `Measured audio energy${value} near ${at}`;
      case "silence-boundary": return `Measured silence boundary at ${at}`;
      case "audio-section-boundary": return `Measured audio section boundary at ${at}`;
      case "scene-change": return `${clip} has a measured scene change${value} at ${at}`;
      case "motion-shift": return `${clip} has a measured motion shift${value} at ${at}`;
      case "camera-motion": return `${clip} has measured camera motion${value} near ${at}`;
      case "framing": return `${clip} has measured framing ${record.label} near ${at}`;
      case "face-presence": return `${clip} has measured face presence${value} near ${at}`;
      case "sharpness": return `${clip} has measured sharpness${value} near ${at}`;
      case "exposure": return `${clip} has measured brightness${value} near ${at}`;
      case "semantic-confidence": return `${clip} has measured framing confidence${value} near ${at}`;
      case "source-availability": return `${clip} is available at ${at}`;
    }
  }).join("; ") + ".";
}
