import type { EditingDecision, JsonObject } from "../planning/plannerTypes";

export interface EditorialFinding {
  code: string;
  severity: "info" | "warning";
  start: number;
  end: number;
  evidence: string;
}

export function critiqueTimeline(decisions: EditingDecision[], videos: JsonObject[], candidates: JsonObject[] = [], boundaries: number[] = []): EditorialFinding[] {
  const findings: EditorialFinding[] = [];
  if (!decisions.length) return findings;
  const add = (code: string, start: number, end: number, evidence: string) => findings.push({ code, severity: "warning", start, end, evidence });
  const clips = new Set(decisions.map((item) => item.clipId));
  const durations = decisions.map((item) => item.end - item.start);
  const short = decisions.filter((item) => item.end - item.start < 0.75);
  if (short.length >= 3 && short.length / decisions.length > 0.25) add("micro-shot-abuse", short[0].start, short.at(-1)!.end, `${short.length} of ${decisions.length} shots are under 0.75 seconds`);
  if (videos.length > 1 && clips.size === 1 && decisions.at(-1)!.end - decisions[0].start > 30) add("low-variety", decisions[0].start, decisions.at(-1)!.end, `One of ${videos.length} available sources used`);
  if (clips.size >= 4 && decisions.length >= 6 && durations.filter((value) => value < 1.5).length > durations.length / 2) add("unmotivated-variety", decisions[0].start, decisions.at(-1)!.end, `${clips.size} sources and predominantly brief shots`);
  for (let i = 2; i < decisions.length; i++) {
    if (decisions[i].clipId === decisions[i - 2].clipId && decisions[i - 1].end - decisions[i - 1].start < 2) {
      add("rapid-return", decisions[i - 2].start, decisions[i].end, `A-B-A return via ${decisions[i - 1].clipId}`);
    }
    if (i >= 3 && decisions[i].clipId === decisions[i - 2].clipId && decisions[i - 1].clipId === decisions[i - 3].clipId) {
      add("mechanical-alternation", decisions[i - 3].start, decisions[i].end, "Four consecutive shots alternate between the same two sources");
    }
  }
  if (durations.length >= 5) {
    const intervals = durations.slice(0, -1);
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    if (mean > 0 && intervals.every((value) => Math.abs(value - mean) <= Math.max(0.08, mean * 0.06))) add("fixed-cadence", decisions[0].start, decisions.at(-1)!.end, `Intervals cluster around ${mean.toFixed(2)} seconds`);
  }
  for (const item of decisions) {
    if (item.end - item.start > 25 && videos.length > 1) add("long-stretch", item.start, item.end, `Uninterrupted ${item.clipId} shot lasts ${(item.end - item.start).toFixed(1)} seconds; review context before changing it`);
    if (boundaries.some((at) => Math.abs(item.start - at) < 0.02) && item.start > 0) add("boundary-artifact", item.start, item.end, "Switch aligns with an internal planning boundary");
  }
  const high = candidates.filter((item) => Number(item.score) >= 10);
  if (high.length >= 3 && decisions.length === 1 && videos.length > 1) add("missed-opportunities", decisions[0].start, decisions[0].end, `${high.length} high-confidence candidate moments were unused`);
  return findings;
}
