import type { JsonObject } from "../planning/plannerTypes";
import { number } from "../shared";
import { createHash } from "node:crypto";

export const creativeIntents = ["continuity", "visual-contrast", "framing-change", "motion-change", "rhythmic-response", "spatial-reset", "detail-emphasis", "hold-strong-shot"] as const;
export type CreativeIntent = typeof creativeIntents[number];
export type EvidenceType = "audio-transient" | "audio-energy" | "silence-boundary" | "audio-section-boundary" | "scene-change" | "motion-shift" | "motion-state" | "camera-motion" | "framing" | "face-presence" | "sharpness" | "exposure" | "semantic-confidence" | "source-availability";
export interface EvidenceRecord { id: string; canonicalKey?: string; type: EvidenceType; at: number; clipId?: string; value?: number; label?: string; windowStart?: number; windowEnd?: number; opening?: boolean }

export function identifyEvidenceRecord(record: Omit<EvidenceRecord, "id" | "canonicalKey">): EvidenceRecord {
  const normalized = { type: record.type, at: record.at, clipId: record.clipId, value: record.value, label: record.label, windowStart: record.windowStart, windowEnd: record.windowEnd, opening: record.opening };
  const digest = createHash("sha256").update(JSON.stringify(normalized)).digest();
  return { id: `e_${digest.toString("base64url").slice(0, 10)}`, canonicalKey: digest.toString("hex"), ...record };
}

export function assertUniqueEvidenceIds(records: EvidenceRecord[]): void {
  const seen = new Map<string, string>();
  for (const record of records) {
    const identity = JSON.stringify({ canonicalKey: record.canonicalKey, type: record.type, at: record.at, clipId: record.clipId, value: record.value, label: record.label, windowStart: record.windowStart, windowEnd: record.windowEnd, opening: record.opening });
    const previous = seen.get(record.id);
    if (previous && previous !== identity) throw new Error(`Canonical evidence identity collision: ${record.id}`);
    seen.set(record.id, identity);
  }
}

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

export function buildEvidenceCatalog(audio: JsonObject, videos: JsonObject[], sectionStart: number, sectionEnd: number, candidateTimes: number[], openingScope?: { start: number; end: number }): EvidenceRecord[] {
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
    if (openingScope && sectionStart === 0 && sectionStart >= availableStart - 0.001 && sectionStart < availableEnd - 0.001) {
      const openingMeasurements = Array.isArray(video.openingMeasurements) ? video.openingMeasurements as JsonObject[] : [];
      for (const item of openingMeasurements) {
        const at = number(item.at, NaN);
        const type = item.type as EvidenceType;
        if (!Number.isFinite(at) || at < openingScope.start || at > openingScope.end || !["framing", "face-presence", "motion-state", "camera-motion", "sharpness", "exposure"].includes(type)) continue;
        const value = number(item.value, NaN);
        const label = typeof item.label === "string" ? item.label : undefined;
        if (type === "framing" ? !label || !/^(?:wide|medium|close|tight|long|full|mid)(?:[ -](?:shot|up|view))?$/i.test(label) : !Number.isFinite(value)) continue;
        records.push({ type, at, clipId, opening: true, ...(label ? { label } : {}), ...(Number.isFinite(value) ? { value } : {}) });
      }
    }
    const editMoments = Array.isArray(video.editMoments) ? video.editMoments as JsonObject[] : [];
    for (const item of editMoments) {
      if (item.type === "scene-change" || item.type === "motion-shift") add({ type: item.type, at: number(item.time, NaN), clipId, value: number(item.strength, NaN) });
    }
    // New analyzer output has sample-bounded intervals. Legacy window-only
    // summaries remain readable, but their broad buckets must not override
    // the tighter measured coverage of current analyses.
    const windows = Array.isArray(video.stateIntervals) ? [] : Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
    const stateIntervals = Array.isArray(video.stateIntervals) ? video.stateIntervals as JsonObject[] : [];
    for (const at of points) {
      if (at < availableStart - 0.01 || at >= availableEnd - 0.01) continue;
      add({ type: "source-availability", at, clipId });
      for (const state of stateIntervals) {
        const windowStart = number(state.timelineStart, NaN), windowEnd = number(state.timelineEnd, NaN);
        const type = state.type as EvidenceType;
        if (!(windowStart <= at && at < windowEnd) || !["framing", "face-presence", "motion-state", "camera-motion", "sharpness", "exposure"].includes(type)) continue;
        const value = number(state.value, NaN);
        const label = typeof state.label === "string" ? state.label : undefined;
        if (type === "framing" ? !label : !Number.isFinite(value)) continue;
        add({ type, at, clipId, windowStart, windowEnd, ...(label ? { label } : {}), ...(Number.isFinite(value) ? { value } : {}) });
      }
      const window = windows.find((w) => number(w.timelineStart, NaN) <= at && number(w.timelineEnd, NaN) > at);
      if (!window) continue;
      const windowStart = number(window.timelineStart, NaN), windowEnd = number(window.timelineEnd, NaN);
      const metric = (type: EvidenceType, value: unknown) => {
        const measured = number(value, NaN);
        if (Number.isFinite(measured)) add({ type, at, clipId, value: measured, windowStart, windowEnd });
      };
      metric("face-presence", window.facePresence);
      metric("motion-state", window.motion);
      metric("camera-motion", window.globalMotion);
      metric("sharpness", window.sharpness);
      metric("exposure", window.brightness);
      metric("semantic-confidence", window.framingRoleConfidence);
      const label = typeof window.framingRole === "string" && window.framingRole ? window.framingRole : typeof window.shotScale === "string" ? window.shotScale : "";
      if (/^(?:wide|medium|close|tight|long|full|mid|unknown)(?:[ -](?:shot|up|view))?$/i.test(label)) add({ type: "framing", at, clipId, label: label.toLowerCase(), windowStart, windowEnd });
    }
  }
  const identified = records.filter((record) => record.type === "source-availability" || record.type === "audio-energy" || record.type === "framing" || record.value === undefined || Number.isFinite(record.value))
    .map(identifyEvidenceRecord);
  assertUniqueEvidenceIds(identified);
  return [...new Map(identified.map((record) => [record.id, record])).values()];
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
      case "motion-state": return `${clip} has measured motion${value} near ${at}`;
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
