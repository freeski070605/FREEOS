import type { JsonObject } from "./plannerTypes";
import { number } from "../shared";

export type SectionOpeningMode = "initial-selection" | "continuation" | "availability-transition";
export interface SectionOpeningState { mode: SectionOpeningMode; clipId: string }

export class NoLegalSourceContinuationError extends Error {
  readonly code = "no-legal-source-continuation";
  constructor(public readonly sectionStart: number) {
    super(`No video source is available at section start ${sectionStart}.`);
  }
}

export function availableOpeningClips(videos: JsonObject[], at: number): string[] {
  return videos.filter((video) =>
    at >= number(video.timelineAvailableStart, 0) - 0.001 &&
    at < number(video.timelineAvailableEnd, 0) - 0.001
  ).map((video) => String(video.id));
}

export function deterministicOpening(previousClipId: string, videos: JsonObject[], at: number): SectionOpeningState | undefined {
  if (!previousClipId) return undefined;
  const available = availableOpeningClips(videos, at);
  if (available.includes(previousClipId)) return { mode: "continuation", clipId: previousClipId };
  if (available.length === 1) return { mode: "availability-transition", clipId: available[0] };
  return undefined;
}
