import type { EditingDecision, JsonObject } from "../planning/plannerTypes";

export interface EditorialFinding {
  code: string;
  severity: "info" | "warning" | "material" | "invalid";
  start: number;
  end: number;
  evidence: string;
}

export interface CriticContext { userIntent?: unknown; classification?: string; academyGuidance?: string }

export function critiqueTimeline(decisions: EditingDecision[], videos: JsonObject[], candidates: JsonObject[] = [], boundaries: number[] = [], context: CriticContext = {}): EditorialFinding[] {
  const findings: EditorialFinding[] = [];
  if (!decisions.length) return findings;
  const intent = JSON.stringify(context.userIntent ?? "").toLowerCase();
  const energetic = /more cuts|substantially more|visual energy|faster pac|high.energy|dynamic|energetic|punchier|more visual variety/.test(intent);
  const slow = /contemplative|slow pac|long hold|sustain|meditative|deliberate|less cuts|fewer cuts/.test(intent);
  const interviewLike = /interview|documentary/.test(context.classification ?? "");
  const academyPacing = /vary cut density|avoid repetitive alternation|metronome edit/i.test(context.academyGuidance ?? "");
  const add = (code: string, severity: EditorialFinding["severity"], start: number, end: number, evidence: string) => findings.push({ code, severity, start, end, evidence });
  const clips = new Set(decisions.map((item) => item.clipId));
  const durations = decisions.map((item) => item.end - item.start);
  const short = decisions.filter((item) => item.end - item.start < 0.75);
  if (short.length >= 3 && short.length / decisions.length > 0.25) add("micro-shot-abuse", "warning", short[0].start, short.at(-1)!.end, `${short.length} of ${decisions.length} shots are under 0.75 seconds`);
  if (videos.length > 1 && clips.size === 1 && decisions.at(-1)!.end - decisions[0].start > 30) add("low-variety", energetic ? "material" : "warning", decisions[0].start, decisions.at(-1)!.end, `One of ${videos.length} available sources used`);
  if (clips.size >= 4 && decisions.length >= 6 && durations.filter((value) => value < 1.5).length > durations.length / 2) add("unmotivated-variety", "warning", decisions[0].start, decisions.at(-1)!.end, `${clips.size} sources and predominantly brief shots`);
  for (let i = 2; i < decisions.length; i++) {
    if (decisions[i].clipId === decisions[i - 2].clipId && decisions[i - 1].end - decisions[i - 1].start < 2) add("rapid-return", "warning", decisions[i - 2].start, decisions[i].end, `A-B-A return via ${decisions[i - 1].clipId}`);
    if (i >= 3 && decisions[i].clipId === decisions[i - 2].clipId && decisions[i - 1].clipId === decisions[i - 3].clipId) add("mechanical-alternation", "material", decisions[i - 3].start, decisions[i].end, "Four consecutive shots alternate between the same two sources");
  }
  if (durations.length >= 5) {
    const intervals = durations.slice(0, -1);
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    if (mean > 0 && intervals.every((value) => Math.abs(value - mean) <= Math.max(0.08, mean * 0.06))) add("fixed-cadence", academyPacing ? "material" : "warning", decisions[0].start, decisions.at(-1)!.end, `Intervals cluster around ${mean.toFixed(2)} seconds`);
  }
  const total = decisions.at(-1)!.end - decisions[0].start;
  const density = candidates.length / Math.max(1, total / 60);
  const materialHold = energetic && !slow && videos.length > 1 && density >= 3;
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianDuration = sortedDurations[Math.floor(sortedDurations.length / 2)];
  const longThreshold = slow ? Math.max(45, total * 0.4) : materialHold ? Math.max(12, Math.min(total * 0.16, medianDuration * 1.25)) : interviewLike ? 35 : 25;
  for (const item of decisions) {
    const length = item.end - item.start;
    if (length > longThreshold && videos.length > 1) {
      const localCandidates = candidates.filter((candidate) => Number(candidate.at) > item.start + 1 && Number(candidate.at) < item.end - 1).length;
      const severity = materialHold && localCandidates >= 2 ? "material" : slow ? "info" : "warning";
      add("long-stretch", severity, item.start, item.end, `Uninterrupted ${length.toFixed(1)} second shot; ${localCandidates} measured opportunities inside; requested pacing ${energetic ? "energetic" : slow ? "contemplative" : "unspecified"}`);
    }
    if (boundaries.some((at) => Math.abs(item.start - at) < 0.02) && item.start > 0) add("boundary-artifact", "warning", item.start, item.end, "Switch aligns with an internal planning boundary");
  }
  const high = candidates.filter((item) => Number(item.score) >= 10);
  if (high.length >= 3 && decisions.length === 1 && videos.length > 1) add("missed-opportunities", energetic ? "material" : "warning", decisions[0].start, decisions[0].end, `${high.length} high-confidence candidate moments were unused`);
  return findings;
}
