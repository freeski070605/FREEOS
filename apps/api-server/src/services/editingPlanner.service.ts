import { config } from "../config";
import { adobeService } from "./adobe.service";
import { generateWithOllama } from "./ollama.service";

type JsonObject = Record<string, unknown>;

export interface EditingPlannerClipInput {
  id: string;
  path: string;
  timelineOffsetSeconds?: number;
  exclude?: boolean;
}

export interface EditingPlannerRequest {
  audioPath: string;
  clips: EditingPlannerClipInput[];
  durationSeconds?: number;
  project?: string;
  sequence?: string;
  userIntent?: string;
  sampleFps?: number;
}

export interface EditingDecision {
  start: number;
  end: number;
  clipId: string;
  action: "cut" | "hold" | "punch-in";
  confidence: number;
  rationale: string;
}

export interface EditingPlan {
  version: string;
  durationSeconds: number;
  creativeSummary: string;
  decisions: EditingDecision[];
  cautions: string[];
  evidence: {
    audioAnalysisVersion?: string;
    videoAnalysisVersions: Record<string, string | undefined>;
  };
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compactAudio(raw: unknown): JsonObject {
  const a = asObject(raw, "audio analysis");
  const take = (key: string) => a[key];
  return {
    durationSeconds: take("durationSeconds"),
    tempo: take("tempo"),
    beats: Array.isArray(take("beats")) ? (take("beats") as unknown[]).slice(0, 1200) : [],
    downbeats: Array.isArray(take("downbeats")) ? take("downbeats") : [],
    sections: Array.isArray(take("sections")) ? take("sections") : [],
    energyCurve: Array.isArray(take("energyCurve")) ? (take("energyCurve") as unknown[]).filter((_, i) => i % 2 === 0) : [],
    transients: Array.isArray(take("transients")) ? (take("transients") as unknown[]).slice(0, 1000) : [],
    loudness: take("loudness"),
    silenceRegions: take("silenceRegions"),
    intro: take("intro"),
    outro: take("outro"),
    analysisVersion: take("analysisVersion"),
  };
}

function compactVideo(raw: unknown, input: EditingPlannerClipInput): JsonObject {
  const v = asObject(raw, `video analysis for ${input.id}`);
  const timeline = Array.isArray(v.timeline) ? v.timeline as JsonObject[] : [];
  return {
    id: input.id,
    timelineOffsetSeconds: input.timelineOffsetSeconds ?? 0,
    durationSeconds: v.durationSeconds,
    width: v.width,
    height: v.height,
    fps: v.fps,
    sampleFps: v.sampleFps,
    summary: v.summary,
    sceneChanges: v.sceneChanges,
    qualityFlags: v.qualityFlags,
    analysisVersion: v.analysisVersion,
    timeline: timeline.map((f) => ({
      time: f.time,
      sharpness: f.sharpness,
      brightness: f.brightness,
      motion: f.motion,
      sceneChange: f.sceneChange,
      faceCount: f.faceCount,
      largestFace: f.largestFace,
      underexposedFraction: f.underexposedFraction,
      overexposedFraction: f.overexposedFraction,
    })),
  };
}

function parsePlan(text: string, allowedClipIds: Set<string>, duration: number): EditingPlan {
  let parsed: JsonObject;
  try { parsed = asObject(JSON.parse(text), "editing plan"); }
  catch { throw new Error("FREEOS creative planner returned malformed JSON."); }

  const rawDecisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  if (!rawDecisions.length) throw new Error("FREEOS creative planner returned no edit decisions.");

  const decisions: EditingDecision[] = rawDecisions.map((item, index) => {
    const d = asObject(item, `decision ${index}`);
    const start = number(d.start, NaN);
    const end = number(d.end, NaN);
    const clipId = typeof d.clipId === "string" ? d.clipId : "";
    const action = d.action;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.1) throw new Error(`Planner decision ${index} has invalid timing.`);
    if (!allowedClipIds.has(clipId)) throw new Error(`Planner decision ${index} references unknown clip '${clipId}'.`);
    if (action !== "cut" && action !== "hold" && action !== "punch-in") throw new Error(`Planner decision ${index} has invalid action.`);
    return {
      start,
      end,
      clipId,
      action,
      confidence: Math.max(0, Math.min(1, number(d.confidence, 0.5))),
      rationale: typeof d.rationale === "string" ? d.rationale.slice(0, 500) : "",
    };
  }).sort((a, b) => a.start - b.start);

  for (let i = 1; i < decisions.length; i++) {
    if (decisions[i].start < decisions[i - 1].end - 0.01) throw new Error("Planner decisions overlap.");
  }

  const videoAnalysisVersions = asObject(parsed.evidence ?? {}, "evidence").videoAnalysisVersions;
  return {
    version: typeof parsed.version === "string" ? parsed.version : "freeos-creative-planner-v1",
    durationSeconds: duration,
    creativeSummary: typeof parsed.creativeSummary === "string" ? parsed.creativeSummary.slice(0, 4000) : "",
    decisions,
    cautions: Array.isArray(parsed.cautions) ? parsed.cautions.filter((v): v is string => typeof v === "string").slice(0, 50) : [],
    evidence: {
      audioAnalysisVersion: typeof asObject(parsed.evidence ?? {}, "evidence").audioAnalysisVersion === "string" ? asObject(parsed.evidence ?? {}, "evidence").audioAnalysisVersion as string : undefined,
      videoAnalysisVersions: videoAnalysisVersions && typeof videoAnalysisVersions === "object" && !Array.isArray(videoAnalysisVersions) ? videoAnalysisVersions as Record<string, string | undefined> : {},
    },
  };
}

export async function buildCreativeEditPlan(input: EditingPlannerRequest): Promise<EditingPlan> {
  if (!input.audioPath?.trim()) throw new Error("audioPath is required.");
  const included = input.clips.filter((clip) => !clip.exclude);
  if (!included.length) throw new Error("At least one non-excluded clip is required.");
  if (new Set(included.map((clip) => clip.id)).size !== included.length) throw new Error("Clip ids must be unique.");

  const sampleFps = Math.max(0.5, Math.min(4, input.sampleFps ?? 2));
  const [audioRaw, ...videoRaw] = await Promise.all([
    adobeService.run("media", "media.audio.analyze", { path: input.audioPath }),
    ...included.map((clip) => adobeService.run("media", "media.video.analyze", { path: clip.path, sampleFps })),
  ]);

  const audio = compactAudio(audioRaw);
  const videos = videoRaw.map((raw, index) => compactVideo(raw, included[index]));
  const inferredDuration = number(audio.durationSeconds, 0);
  const duration = input.durationSeconds && input.durationSeconds > 0 ? input.durationSeconds : inferredDuration;
  if (!duration) throw new Error("Could not determine edit duration.");

  const evidenceBundle = {
    project: input.project,
    sequence: input.sequence,
    durationSeconds: duration,
    userIntent: input.userIntent ?? "Create the strongest complete performance edit from the available synchronized footage.",
    excludedClipIds: input.clips.filter((clip) => clip.exclude).map((clip) => clip.id),
    audio,
    clips: videos,
  };

  const system = `You are FREEOS's creative video editing planner. Return valid JSON only.
You make the creative editing decisions yourself from measured evidence. Do not use a fixed weighted scoring formula, do not mechanically cut on every beat, and do not assume that face presence alone means a shot is preferable. Infer visual roles from the evidence, consider musical dynamics and performance continuity, and choose cuts deliberately.
The analyzers provide observations, not creative judgments. Respect excluded clips. Never invent measurements, lyrics, sections, beats, sync, or footage that are absent from the evidence. If evidence is uncertain, reflect that in confidence or cautions.
Output exactly this shape:
{"version":"freeos-creative-planner-v1","durationSeconds":number,"creativeSummary":string,"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string],"evidence":{"audioAnalysisVersion":string,"videoAnalysisVersions":{"clipId":string}}}
Decisions must be chronological, non-overlapping, use only supplied clip ids, remain within durationSeconds, and cover the intended edit as completely as the available source timing permits. A timelineOffsetSeconds means source time 0 aligns to that sequence time.`;

  const text = await generateWithOllama({
    model: config.defaultModel,
    system,
    prompt: JSON.stringify(evidenceBundle),
    format: "json",
    timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 300_000),
    options: { temperature: 0.35, top_p: 0.9, repeat_penalty: 1.05, num_predict: 6000 },
  });

  const plan = parsePlan(text, new Set(included.map((clip) => clip.id)), duration);
  plan.evidence.audioAnalysisVersion = typeof audio.analysisVersion === "string" ? audio.analysisVersion : undefined;
  plan.evidence.videoAnalysisVersions = Object.fromEntries(videos.map((video) => [String(video.id), typeof video.analysisVersion === "string" ? video.analysisVersion : undefined]));
  return plan;
}
