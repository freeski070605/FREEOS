import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Artifact, EvaluationResult, QualityFinding } from "./core";

const exec = promisify(execFile);
export interface RenderFrame { time: number; lumaMean: number; p05: number; p50: number; p95: number; blackFloor: number; shadowClipping: number; highlightClipping: number; globalContrast: number; localContrast: number; saturation: number; sharpness: number; edgeEnergy: number; noise: number; brightnessChange: number }
export interface RenderPixels { duration: number; sampleFps: number; frames: RenderFrame[]; summary: Record<string, number>; analysisVersion: string }
export interface RenderProbe { path: string; duration: number; width: number; height: number; fps: number; codec: string; bitrate: number; pixelFormat?: string; filesize: number; audioPresent: boolean; audioCodec?: string; sampleRate?: number; channels?: number; createdAt: string }
export interface RenderAudio { durationSeconds: number; loudness: { integratedLUFS: number | null; truePeak: number | null; rangeLU: number | null }; silenceRegions: Array<{ start: number; end: number }> }
const ffprobe = () => process.env.FREEOS_FFPROBE_PATH || (process.env.FREEOS_FFMPEG_PATH ? path.join(path.dirname(process.env.FREEOS_FFMPEG_PATH), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe");
const python = () => process.env.FREEOS_VIDEO_PYTHON || process.env.FREEOS_AUDIO_PYTHON || path.resolve(process.cwd(), "packages/media-intelligence/.venv/Scripts/python.exe");
const script = () => path.resolve(process.cwd(), "packages/media-intelligence/python/render_quality.py");
function rate(value: string | undefined): number { if (!value) return 0; const [a, b] = value.split("/").map(Number); return b ? a / b : Number(value) || 0; }
export async function probeRender(file: string): Promise<RenderProbe> {
  const resolved = path.resolve(file);
  if (!existsSync(resolved) || !statSync(resolved).isFile() || !statSync(resolved).size) throw new Error("Review render file is absent or empty.");
  const { stdout } = await exec(ffprobe(), ["-v", "error", "-show_format", "-show_streams", "-of", "json", resolved], { timeout: 60000, maxBuffer: 4_000_000, windowsHide: true });
  const raw = JSON.parse(stdout) as { format?: { duration?: string; bit_rate?: string }; streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; bit_rate?: string; pix_fmt?: string; duration?: string; sample_rate?: string; channels?: number }> };
  const video = raw.streams?.find(s => s.codec_type === "video");
  const audio = raw.streams?.find(s => s.codec_type === "audio");
  const duration = Number(video?.duration || raw.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) throw new Error("Review render lacks a valid video stream.");
  const stat = statSync(resolved);
  return { path: resolved, duration, width: video.width, height: video.height, fps: rate(video.avg_frame_rate), codec: video.codec_name || "unknown", bitrate: Number(video.bit_rate || raw.format?.bit_rate || 0), pixelFormat: video.pix_fmt, filesize: stat.size, audioPresent: !!audio, audioCodec: audio?.codec_name, sampleRate: audio ? Number(audio.sample_rate || 0) : undefined, channels: audio?.channels, createdAt: stat.birthtime.toISOString() };
}
export async function analyzeRenderPixels(file: string, sampleFps = 1): Promise<RenderPixels> {
  const { stdout } = await exec(python(), [script(), file, String(sampleFps)], { timeout: 900000, maxBuffer: 24_000_000, windowsHide: true });
  const pixels = JSON.parse(stdout) as RenderPixels;
  if (!Array.isArray(pixels.frames) || !pixels.frames.length || !pixels.summary || pixels.analysisVersion !== "render-quality-v1") throw new Error("Pixel analyzer returned incomplete evidence.");
  return pixels;
}
export function compareRenderPixels(before: RenderPixels, after: RenderPixels): Record<string, number> {
  return Object.fromEntries(["lumaMean", "blackFloor", "globalContrast", "localContrast", "saturation", "sharpness", "noise", "shadowClipping", "highlightClipping"].map(key => [key, Number(((after.summary[key] ?? 0) - (before.summary[key] ?? 0)).toFixed(6))]));
}
export function compareRenderIntervals(source: RenderPixels, render: RenderPixels): Array<{ time: number; localContrastDelta: number; blackFloorDelta: number; brightnessDelta: number; saturationDelta: number; sharpnessDelta: number }> {
  const tolerance = Math.max(0.5, 1 / Math.min(source.sampleFps, render.sampleFps));
  return render.frames.flatMap(frame => {
    const match = source.frames.reduce<RenderFrame | undefined>((best, candidate) => !best || Math.abs(candidate.time - frame.time) < Math.abs(best.time - frame.time) ? candidate : best, undefined);
    if (!match || Math.abs(match.time - frame.time) > tolerance) return [];
    return [{ time: frame.time, localContrastDelta: Number((frame.localContrast - match.localContrast).toFixed(6)), blackFloorDelta: Number((frame.blackFloor - match.blackFloor).toFixed(6)), brightnessDelta: Number((frame.lumaMean - match.lumaMean).toFixed(6)), saturationDelta: Number((frame.saturation - match.saturation).toFixed(6)), sharpnessDelta: Number((frame.sharpness - match.sharpness).toFixed(6)) }];
  });
}
export function effectDensityReview(artifact: Artifact, duration: number, userIntent: string): { metrics: Record<string, number>; findings: QualityFinding[] } {
  const effects = (artifact.metadata?.effectExecutions ?? []) as Array<{ skillId?: string; timelineStart?: number; timelineEnd?: number }>;
  const active = effects.filter(e => e.skillId && e.skillId !== "video.effect.remove");
  const per10Seconds = duration > 0 ? active.length * 10 / duration : 0;
  const count = (pattern: RegExp) => active.filter(e => pattern.test(e.skillId!)).length;
  const flash = count(/flash/i), blur = count(/blur/i), zoom = count(/zoom/i);
  const repetition = Math.max(0, ...[...new Set(active.map(e => e.skillId))].map(id => active.filter(e => e.skillId === id).length));
  const transitions = active.filter(e => e.skillId?.startsWith("video.transition."));
  const transitionFamilyRepetition = Math.max(0, ...[...new Set(transitions.map(e => e.skillId?.split(".").slice(0, 3).join(".")))].map(family => transitions.filter(e => e.skillId?.startsWith(family!)).length));
  const metrics = { effectLineageCount: active.length, effectsPer10Seconds: per10Seconds, sameEffectRepetition: repetition, transitionFamilyRepetition, flashFrequency: duration > 0 ? flash / duration : 0, blurEffectDensity: duration > 0 ? blur * 10 / duration : 0, zoomEffectDensity: duration > 0 ? zoom * 10 / duration : 0 };
  const stylized = /intense|rapid|glitch|flash|hyper|experimental|music video/i.test(userIntent);
  const findings: QualityFinding[] = [];
  if (active.length >= 5 && (per10Seconds > (stylized ? 8 : 4) || repetition >= (stylized ? 7 : 4))) findings.push({ id: `video-quality.effect-repetition:${artifact.artifactId}`, domain: "video", artifactId: artifact.artifactId, category: "creative", severity: stylized ? "warning" : "material", description: "video-quality.effect-repetition", evidence: [{ metrics, effectExecutions: active }], confidence: .8, repairable: true, suggestedSkillCategories: ["effect", "repair"] });
  return { metrics, findings };
}
export function evaluateRenderQuality(artifact: Artifact, probe: RenderProbe, pixels: RenderPixels, options: { audioExpected?: boolean; source?: RenderPixels; audio?: RenderAudio } = {}): EvaluationResult {
  const findings: QualityFinding[] = [];
  const add = (code: string, severity: QualityFinding["severity"], evidence: unknown, category = "technical", confidence = .85) => findings.push({ id: `${code}:${artifact.artifactId}`, domain: "video", artifactId: artifact.artifactId, category, severity, description: code, evidence: [evidence], confidence, repairable: true, suggestedSkillCategories: category === "audio" ? ["audio"] : ["repair", "color"] });
  const s = pixels.summary;
  const hazy = pixels.frames.filter(f => f.blackFloor > .09 && f.globalContrast < .17 && f.localContrast < .035 && f.p05 > .12);
  if (hazy.length >= Math.max(2, pixels.frames.length * .55)) add("video-quality.low-contrast-haze", "material", { intervals: hazy.map(f => [f.time, f.time + 1 / pixels.sampleFps]), measurements: { blackFloor: s.blackFloor, globalContrast: s.globalContrast, localContrast: s.localContrast, p05: s.p05 } }, "technical", .9);
  if (s.sharpness < .00015 && s.edgeEnergy < .018) add("video-quality.soft-render", "material", { sharpness: s.sharpness, edgeEnergy: s.edgeEnergy, times: pixels.frames.filter(f => f.sharpness < .00015).map(f => f.time) });
  if (s.shadowClipping > .04 && s.p05 < .04) add("video-quality.crushed-blacks", "material", { shadowClipping: s.shadowClipping, p05: s.p05, times: pixels.frames.filter(f => f.shadowClipping > .04).map(f => f.time) });
  if (s.highlightClipping > .22) add("video-quality.clipped-highlights", "material", { highlightClipping: s.highlightClipping });
  if (options.audioExpected && !probe.audioPresent) add("video-quality.audio-missing", "blocking", { audioPresent: false }, "audio", 1);
  if (probe.audioPresent && !options.audio) add("video-quality.audio-uninspected", "blocking", { audioPresent: true, analyzed: false }, "audio", 1);
  if (options.audio) {
    if (options.audio.durationSeconds < probe.duration * .9) add("video-quality.audio-short", "material", { audioDuration: options.audio.durationSeconds, videoDuration: probe.duration }, "audio");
    if (options.audio.loudness.integratedLUFS === null || options.audio.loudness.truePeak === null) add("video-quality.audio-loudness-unmeasured", "blocking", { loudness: options.audio.loudness }, "audio");
    else {
      if (options.audio.loudness.truePeak > 0) add("video-quality.audio-clipping", "material", { truePeak: options.audio.loudness.truePeak }, "audio");
      if (options.audio.loudness.integratedLUFS < -30) add("video-quality.audio-too-quiet", "material", { integratedLUFS: options.audio.loudness.integratedLUFS }, "audio");
    }
    const longSilence = options.audio.silenceRegions.filter(r => r.end - r.start > 1 && r.start > .1 && r.end < probe.duration - .1);
    if (longSilence.length) add("video-quality.audio-dropout", "material", { silenceRegions: longSilence }, "audio");
  }
  const sourceComparable = !!options.source && Math.abs(options.source.duration - pixels.duration) <= Math.max(1, pixels.duration * .1);
  if (sourceComparable && options.source) {
    const d = compareRenderPixels(options.source, pixels);
    if (d.localContrast < -.01 && d.sharpness < -.0002) add("video-quality.processing-regression", "material", { sourceToRenderDeltas: d });
  }
  return { id: randomUUID(), evaluatorId: "video.render.review-analyzer", artifactId: artifact.artifactId, reviewType: "executed-artifact", dimensionScores: [{ dimensionId: "render", score: findings.some(f => f.severity === "material" || f.severity === "blocking") ? .3 : 1, measurementType: "rendered-pixels", confidence: .9 }, { dimensionId: "artifact-integrity", score: 1, measurementType: "ffprobe", confidence: 1 }, ...(options.audioExpected || probe.audioPresent ? [{ dimensionId: "audio-quality", score: options.audio && !findings.some(f => f.category === "audio") ? 1 : 0, measurementType: "audio-analysis", confidence: 1 }] : [])], findings, evidence: [{ probe, pixels, ...(options.audio ? { audio: options.audio } : {}), ...(sourceComparable && options.source ? { sourceComparison: compareRenderPixels(options.source, pixels), sourceIntervals: compareRenderIntervals(options.source, pixels) } : options.source ? { sourceComparisonSkipped: "Source and render durations are not comparable." } : {}) }], confidence: .9, status: "complete", source: "real-render-quality" };
}
