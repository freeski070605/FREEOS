export interface PerformanceMoment { sourceClip: string; start: number; end: number; visibility: number; energy: number; lipSync: number; focus: number; exposure: number; composition: number; movement: number; unique: number }
export interface MusicalEvent { time: number; strength: number; kind: "beat" | "bar" | "downbeat" | "lyric" | "section"; lyric?: string }
export interface EditDecision { start: number; end: number; sourceTrack: string; sourceClip: string; action: "hold" | "cut" | "punch-in"; confidence: number; reasons: string[]; musicalContext: MusicalEvent[]; lyricContext: string[]; visualContext: Record<string, number> }
export interface EditInput { moments: PerformanceMoment[]; events: MusicalEvent[]; duration: number; minShotSeconds?: number; maxShotSeconds?: number }
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function score(moment: PerformanceMoment): number { return .22 * moment.visibility + .19 * moment.energy + .17 * moment.lipSync + .13 * moment.focus + .1 * moment.exposure + .1 * moment.composition + .05 * moment.movement + .04 * moment.unique; }
export function planPerformanceEdit(input: EditInput): EditDecision[] {
  if (!Number.isFinite(input.duration) || input.duration <= 0) throw new Error("Positive duration required.");
  const min = input.minShotSeconds ?? 1.2, max = input.maxShotSeconds ?? 6;
  if (min <= 0 || max < min) throw new Error("Invalid shot duration limits.");
  const boundaries = [0, ...input.events.filter(e => e.time > 0 && e.time < input.duration && (e.kind === "bar" || e.kind === "section" || e.kind === "lyric" || e.strength >= .85)).map(e => e.time), input.duration].sort((a,b) => a-b);
  const output: EditDecision[] = []; let start = 0; let previous = "";
  for (const boundary of boundaries.slice(1)) {
    if (boundary - start < min && boundary !== input.duration) continue;
    if (boundary - start < max && boundary !== input.duration && !input.events.some(e => Math.abs(e.time - boundary) < .05 && (e.kind === "section" || e.kind === "lyric"))) continue;
    const end = boundary;
    const candidates = input.moments.filter(m => m.start <= start && m.end >= end);
    if (!candidates.length) throw new Error(`No synced performance covers ${start}-${end}.`);
    const ranked = candidates.map(moment => ({ moment, quality: score(moment) - (moment.sourceClip === previous ? .08 : 0) })).sort((a,b) => b.quality - a.quality);
    const best = ranked[0].moment; const event = input.events.filter(e => e.time >= start && e.time <= end);
    const hold = best.sourceClip === previous; const punch = hold && best.composition > .65 && best.focus > .7 && event.some(e => e.kind === "lyric" || e.strength > .9);
    output.push({ start, end, sourceTrack: best.sourceClip, sourceClip: best.sourceClip, action: punch ? "punch-in" : hold ? "hold" : "cut", confidence: clamp(ranked[0].quality), reasons: [best.sourceClip === previous ? "Preserve performance continuity" : "Best synchronized performance", event.some(e => e.kind === "section") ? "Song section change" : "Visual quality"], musicalContext: event, lyricContext: event.filter(e => e.lyric).map(e => e.lyric!), visualContext: { visibility: best.visibility, energy: best.energy, lipSync: best.lipSync, focus: best.focus, exposure: best.exposure, composition: best.composition } });
    previous = best.sourceClip; start = end;
  }
  if (start < input.duration) {
    const candidates = input.moments.filter(m => m.start <= start && m.end >= input.duration).sort((a,b) => score(b)-score(a));
    if (!candidates.length) throw new Error("No performance covers the final segment.");
    const best = candidates[0]; output.push({ start, end: input.duration, sourceTrack: best.sourceClip, sourceClip: best.sourceClip, action: best.sourceClip === previous ? "hold" : "cut", confidence: clamp(score(best)), reasons: ["Complete remaining performance"], musicalContext: [], lyricContext: [], visualContext: { visibility: best.visibility, energy: best.energy } });
  }
  return output;
}
export interface ShotColor { clip: string; exposureStops: number; temperature: number; tint: number; contrast: number; saturation: number; skinHue?: number }
export interface ColorAdjustment { clip: string; exposure: number; temperature: number; tint: number; contrast: number; saturation: number; skinHueShift?: number; reasons: string[] }
const median = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.floor(sorted.length / 2)]; };
export function planShotMatch(shots: ShotColor[]): ColorAdjustment[] {
  if (!shots.length) return [];
  const target = { exposure: median(shots.map(s => s.exposureStops)), temperature: median(shots.map(s => s.temperature)), tint: median(shots.map(s => s.tint)), contrast: median(shots.map(s => s.contrast)), saturation: median(shots.map(s => s.saturation)), skinHue: median(shots.filter(s => s.skinHue !== undefined).map(s => s.skinHue!)) };
  return shots.map(shot => ({ clip: shot.clip, exposure: Math.max(-2, Math.min(2, target.exposure-shot.exposureStops)), temperature: target.temperature-shot.temperature, tint: target.tint-shot.tint, contrast: target.contrast-shot.contrast, saturation: target.saturation-shot.saturation, ...(shot.skinHue === undefined || !Number.isFinite(target.skinHue) ? {} : { skinHueShift: target.skinHue-shot.skinHue }), reasons: ["Match shot to sequence median", shot.skinHue === undefined ? "Skin not measured" : "Preserve skin consistency"] }));
}
export interface EffectPlan { start: number; end: number; sourceClip: string; kind: "punch-in" | "shake" | "blur" | "glow"; intensity: number; reason: string }
export function planEffects(decisions: EditDecision[]): EffectPlan[] { return decisions.flatMap(decision => decision.action === "punch-in" ? [{ start: decision.start, end: decision.end, sourceClip: decision.sourceClip, kind: "punch-in" as const, intensity: .12, reason: decision.lyricContext.length ? "Lyric accent" : "Performance emphasis" }] : []); }
export interface ReviewFrame { time: number; luma: number; clippedPixels: number; duplicateOfPrevious: boolean }
export interface ReviewIssue { time: number; kind: "black-frame" | "overexposed" | "frozen-frame"; severity: number }
export function reviewFrames(frames: ReviewFrame[]): ReviewIssue[] { return frames.flatMap(frame => { const issues: ReviewIssue[] = []; if (frame.luma < .015) issues.push({ time: frame.time, kind: "black-frame", severity: 1 }); if (frame.clippedPixels > .2) issues.push({ time: frame.time, kind: "overexposed", severity: clamp(frame.clippedPixels) }); if (frame.duplicateOfPrevious) issues.push({ time: frame.time, kind: "frozen-frame", severity: .5 }); return issues; }); }
