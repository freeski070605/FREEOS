import { config } from "../config";
import { adobeService } from "./adobe.service";
import { generateWithOllama } from "./ollama.service";
import { bootstrapEditingAcademy, buildEditingKnowledgeContext } from "./editingAcademy.service";

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
    editingKnowledgeUnits?: number;
    editingKnowledgeGap?: boolean;
  };
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

function compactAudio(raw: unknown): JsonObject {
  const a = asObject(raw, "audio analysis");
  const energy = Array.isArray(a.energyCurve) ? a.energyCurve as JsonObject[] : [];
  const transients = Array.isArray(a.transients) ? a.transients as JsonObject[] : [];
  const beats = Array.isArray(a.beats) ? a.beats as JsonObject[] : [];
  const windowSeconds = 4;
  const duration = number(a.durationSeconds, 0);
  const windows: JsonObject[] = [];
  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);
    const energies = energy.filter((e) => number(e.time, -1) >= start && number(e.time, -1) < end).map((e) => number(e.rms, NaN));
    const peaks = energy.filter((e) => number(e.time, -1) >= start && number(e.time, -1) < end).map((e) => number(e.peak, NaN));
    const windowTransients = transients.filter((e) => number(e.time, -1) >= start && number(e.time, -1) < end);
    const windowBeats = beats.filter((e) => number(e.time, -1) >= start && number(e.time, -1) < end);
    windows.push({
      start,
      end,
      energyMean: mean(energies),
      peakMean: mean(peaks),
      transientCount: windowTransients.length,
      strongestTransient: windowTransients.reduce((m, e) => Math.max(m, number(e.strength, 0)), 0),
      beatCount: windowBeats.length,
    });
  }
  return {
    durationSeconds: a.durationSeconds,
    tempo: a.tempo,
    downbeats: Array.isArray(a.downbeats) ? a.downbeats : [],
    sections: Array.isArray(a.sections) ? a.sections : [],
    loudness: a.loudness,
    silenceRegions: a.silenceRegions,
    intro: a.intro,
    outro: a.outro,
    windows,
    analysisVersion: a.analysisVersion,
  };
}

function compactVideo(raw: unknown, input: EditingPlannerClipInput): JsonObject {
  const v = asObject(raw, `video analysis for ${input.id}`);
  const timeline = Array.isArray(v.timeline) ? v.timeline as JsonObject[] : [];
  const duration = number(v.durationSeconds, 0);
  const windowSeconds = 4;
  const windows: JsonObject[] = [];
  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);
    const frames = timeline.filter((f) => number(f.time, -1) >= start && number(f.time, -1) < end);
    if (!frames.length) continue;
    const faces = frames.filter((f) => number(f.faceCount, 0) > 0);
    const largestFaces = faces.map((f) => f.largestFace).filter((f): f is JsonObject => !!f && typeof f === "object" && !Array.isArray(f));
    windows.push({
      start,
      end,
      sharpness: mean(frames.map((f) => number(f.sharpness, NaN))),
      brightness: mean(frames.map((f) => number(f.brightness, NaN))),
      motion: mean(frames.map((f) => number(f.motion, NaN))),
      sceneChangeMax: frames.reduce((m, f) => Math.max(m, number(f.sceneChange, 0)), 0),
      facePresence: faces.length / frames.length,
      multiFacePresence: frames.filter((f) => number(f.faceCount, 0) > 1).length / frames.length,
      primaryFaceArea: mean(largestFaces.map((f) => number(f.areaRatio, NaN))),
      primaryFaceCenterX: mean(largestFaces.map((f) => number(f.centerX, NaN))),
      primaryFaceCenterY: mean(largestFaces.map((f) => number(f.centerY, NaN))),
      underexposedFraction: mean(frames.map((f) => number(f.underexposedFraction, NaN))),
      overexposedFraction: mean(frames.map((f) => number(f.overexposedFraction, NaN))),
    });
  }
  return {
    id: input.id,
    timelineOffsetSeconds: input.timelineOffsetSeconds ?? 0,
    durationSeconds: v.durationSeconds,
    width: v.width,
    height: v.height,
    fps: v.fps,
    summary: v.summary,
    sceneChanges: Array.isArray(v.sceneChanges) ? (v.sceneChanges as unknown[]).slice(0, 100) : [],
    qualityFlags: v.qualityFlags,
    analysisVersion: v.analysisVersion,
    windows,
  };
}

function unwrapPlan(parsed: JsonObject): JsonObject {
  if (Array.isArray(parsed.decisions)) return parsed;
  if (parsed.plan && typeof parsed.plan === "object" && !Array.isArray(parsed.plan)) return parsed.plan as JsonObject;
  return parsed;
}

function parsePlan(text: string, allowedClipIds: Set<string>, duration: number): EditingPlan {
  let parsed: JsonObject;
  try { parsed = unwrapPlan(asObject(JSON.parse(text), "editing plan")); }
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
    const typedAction: EditingDecision["action"] = action;
    return {
      start,
      end,
      clipId,
      action: typedAction,
      confidence: Math.max(0, Math.min(1, number(d.confidence, 0.5))),
      rationale: typeof d.rationale === "string" ? d.rationale.slice(0, 500) : "",
    };
  }).sort((a, b) => a.start - b.start);

  for (let i = 1; i < decisions.length; i++) {
    if (decisions[i].start < decisions[i - 1].end - 0.01) throw new Error("Planner decisions overlap.");
  }

  const evidenceObject = parsed.evidence && typeof parsed.evidence === "object" && !Array.isArray(parsed.evidence) ? parsed.evidence as JsonObject : {};
  const videoAnalysisVersions = evidenceObject.videoAnalysisVersions;
  return {
    version: typeof parsed.version === "string" ? parsed.version : "freeos-creative-planner-v1",
    durationSeconds: duration,
    creativeSummary: typeof parsed.creativeSummary === "string" ? parsed.creativeSummary.slice(0, 4000) : "",
    decisions,
    cautions: Array.isArray(parsed.cautions) ? parsed.cautions.filter((v): v is string => typeof v === "string").slice(0, 50) : [],
    evidence: {
      audioAnalysisVersion: typeof evidenceObject.audioAnalysisVersion === "string" ? evidenceObject.audioAnalysisVersion : undefined,
      videoAnalysisVersions: videoAnalysisVersions && typeof videoAnalysisVersions === "object" && !Array.isArray(videoAnalysisVersions) ? videoAnalysisVersions as Record<string, string | undefined> : {},
    },
  };
}

async function askPlanner(system: string, evidenceBundle: unknown): Promise<string> {
  return generateWithOllama({
    model: config.defaultModel,
    system,
    prompt: JSON.stringify(evidenceBundle),
    format: "json",
    timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 480_000),
    options: { temperature: 0.3, top_p: 0.85, repeat_penalty: 1.05, num_predict: 3000 },
  });
}

export async function buildCreativeEditPlan(input: EditingPlannerRequest): Promise<EditingPlan> {
  if (!input.audioPath?.trim()) throw new Error("audioPath is required.");
  const included = input.clips.filter((clip) => !clip.exclude);
  if (!included.length) throw new Error("At least one non-excluded clip is required.");
  if (new Set(included.map((clip) => clip.id)).size !== included.length) throw new Error("Clip ids must be unique.");

  // Idempotent owner-directed seed: knowledge is durable, mastery remains evidence-based.
  bootstrapEditingAcademy();
  const intent = input.userIntent ?? "Create the strongest complete performance edit from the available synchronized footage.";
  const editingKnowledge = buildEditingKnowledgeContext(intent);
  if (editingKnowledge.gap.needsMoreKnowledge) {
    throw new Error(`Editing Academy knowledge gap: ${editingKnowledge.gap.reason} Query: ${editingKnowledge.gap.query}`);
  }

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
    userIntent: intent,
    excludedClipIds: input.clips.filter((clip) => clip.exclude).map((clip) => clip.id),
    evidenceWindowSeconds: 4,
    editingKnowledge: {
      relevantUnits: editingKnowledge.gap.relevantUnits,
      relevantCompetencies: editingKnowledge.gap.relevantCompetencies,
      lowMasteryCompetencies: editingKnowledge.gap.lowMasteryCompetencies,
    },
    audio,
    clips: videos,
  };

  const system = `You are FREEOS's creative video editing planner. Return valid JSON only.
You make the creative editing decisions yourself from measured evidence and the owner-approved Editing Academy knowledge below. The academy is guidance, not a preset system: combine, adapt, or reject techniques according to the footage, song, user intent, and project context. Do not use a fixed weighted scoring formula, do not mechanically cut on every beat, and do not assume face presence alone makes a shot preferable. Infer each camera's visual role from evidence, consider musical dynamics, continuity, contrast, pacing, and source availability, and make deliberate choices.

${editingKnowledge.context}

The supplied analysis windows are condensed measurements from analyzers; they are evidence, not rankings. Respect excluded clips. Never invent lyrics, sections, beats, sync, camera contents, or measurements that are absent. If evidence is uncertain, lower confidence or add a caution. The reported mastery level describes demonstrated practice, not whether the knowledge is available; low mastery should make you more conservative and explicit in rationale.
Produce a complete chronological edit plan. Favor concise rationales so the output stays small.
Output exactly this shape:
{"version":"freeos-creative-planner-v1","durationSeconds":number,"creativeSummary":string,"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string],"evidence":{"audioAnalysisVersion":string,"videoAnalysisVersions":{"clipId":string}}}
The decisions array MUST contain at least one item. Decisions must be chronological, non-overlapping, use only supplied clip ids, remain within durationSeconds, and cover the intended edit as completely as source timing permits. timelineOffsetSeconds means source time 0 aligns to that sequence time.`;

  let text = await askPlanner(system, evidenceBundle);
  try {
    const plan = parsePlan(text, new Set(included.map((clip) => clip.id)), duration);
    plan.evidence.audioAnalysisVersion = typeof audio.analysisVersion === "string" ? audio.analysisVersion : undefined;
    plan.evidence.videoAnalysisVersions = Object.fromEntries(videos.map((video) => [String(video.id), typeof video.analysisVersion === "string" ? video.analysisVersion : undefined]));
    plan.evidence.editingKnowledgeUnits = editingKnowledge.gap.relevantUnits;
    plan.evidence.editingKnowledgeGap = editingKnowledge.gap.needsMoreKnowledge;
    return plan;
  } catch (firstError) {
    console.error("[FREEOS Editing Planner] response excerpt:", text.slice(0, 2000));
    const repairSystem = `Return valid JSON only. Repair the supplied FREEOS edit-plan candidate so it has a non-empty chronological decisions array and exactly matches the required schema. Preserve the candidate's creative intent where possible. Use only these clip ids: ${included.map((clip) => clip.id).join(", ")}. Duration is ${duration}. Do not invent evidence. Required shape: {"version":"freeos-creative-planner-v1","durationSeconds":number,"creativeSummary":string,"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string],"evidence":{"audioAnalysisVersion":string,"videoAnalysisVersions":{"clipId":string}}}`;
    text = await generateWithOllama({
      model: config.defaultModel,
      system: repairSystem,
      prompt: text.slice(0, 12000),
      format: "json",
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 240_000),
      options: { temperature: 0.1, top_p: 0.8, repeat_penalty: 1.05, num_predict: 2500 },
    });
    const plan = parsePlan(text, new Set(included.map((clip) => clip.id)), duration);
    plan.evidence.audioAnalysisVersion = typeof audio.analysisVersion === "string" ? audio.analysisVersion : undefined;
    plan.evidence.videoAnalysisVersions = Object.fromEntries(videos.map((video) => [String(video.id), typeof video.analysisVersion === "string" ? video.analysisVersion : undefined]));
    plan.evidence.editingKnowledgeUnits = editingKnowledge.gap.relevantUnits;
    plan.evidence.editingKnowledgeGap = editingKnowledge.gap.needsMoreKnowledge;
    return plan;
  }
}
