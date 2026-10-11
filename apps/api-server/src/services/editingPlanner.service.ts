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
    plannerMode?: string;
  };
}

interface CreativeBrief {
  creativeSummary: string;
  principles: string[];
  cautions: string[];
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
  const offset = input.timelineOffsetSeconds ?? 0;
  const windowSeconds = 4;
  const windows: JsonObject[] = [];
  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);
    const frames = timeline.filter((f) => number(f.time, -1) >= start && number(f.time, -1) < end);
    if (!frames.length) continue;
    const faces = frames.filter((f) => number(f.faceCount, 0) > 0);
    const largestFaces = faces.map((f) => f.largestFace).filter((f): f is JsonObject => !!f && typeof f === "object" && !Array.isArray(f));
    windows.push({
      sourceStart: start,
      sourceEnd: end,
      timelineStart: start + offset,
      timelineEnd: end + offset,
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
    timelineOffsetSeconds: offset,
    timelineAvailableStart: offset,
    timelineAvailableEnd: offset + duration,
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

function parseCreativeBrief(text: string): CreativeBrief {
  const parsed = asObject(JSON.parse(text), "creative brief");
  return {
    creativeSummary: typeof parsed.creativeSummary === "string" ? parsed.creativeSummary.slice(0, 3000) : "",
    principles: Array.isArray(parsed.principles) ? parsed.principles.filter((v): v is string => typeof v === "string").slice(0, 12) : [],
    cautions: Array.isArray(parsed.cautions) ? parsed.cautions.filter((v): v is string => typeof v === "string").slice(0, 20) : [],
  };
}

function parseSectionDecisions(text: string, allowedClipIds: Set<string>, sectionStart: number, sectionEnd: number, videos: JsonObject[]): EditingDecision[] {
  const parsed = asObject(JSON.parse(text), "section plan");
  const raw = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  if (!raw.length) throw new Error(`FREEOS returned no decisions for section ${sectionStart}-${sectionEnd}.`);
  const decisions = raw.map((item, index): EditingDecision => {
    const d = asObject(item, `section decision ${index}`);
    const start = number(d.start, NaN);
    const end = number(d.end, NaN);
    const clipId = typeof d.clipId === "string" ? d.clipId : "";
    const action = d.action;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < sectionStart - 0.05 || end > sectionEnd + 0.05 || end <= start) throw new Error(`Section decision ${index} has invalid timing.`);
    if (!allowedClipIds.has(clipId)) throw new Error(`Section decision ${index} references unknown clip '${clipId}'.`);
    if (action !== "cut" && action !== "hold" && action !== "punch-in") throw new Error(`Section decision ${index} has invalid action.`);
    const video = videos.find((v) => String(v.id) === clipId);
    if (!video || start < number(video.timelineAvailableStart, 0) - 0.05 || end > number(video.timelineAvailableEnd, 0) + 0.05) throw new Error(`Section decision ${index} uses '${clipId}' outside source availability.`);
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
    if (decisions[i].start < decisions[i - 1].end - 0.01) throw new Error(`Section decisions overlap near ${decisions[i].start}.`);
  }
  return decisions;
}

function sectionEvidence(audio: JsonObject, videos: JsonObject[], start: number, end: number) {
  const audioWindows = Array.isArray(audio.windows) ? audio.windows as JsonObject[] : [];
  return {
    start,
    end,
    audio: {
      tempo: audio.tempo,
      loudness: audio.loudness,
      sections: audio.sections,
      silenceRegions: audio.silenceRegions,
      windows: audioWindows.filter((w) => number(w.end, 0) > start && number(w.start, 0) < end),
    },
    clips: videos.map((video) => {
      const windows = Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
      return {
        id: video.id,
        timelineAvailableStart: video.timelineAvailableStart,
        timelineAvailableEnd: video.timelineAvailableEnd,
        summary: video.summary,
        qualityFlags: video.qualityFlags,
        windows: windows.filter((w) => number(w.timelineEnd, 0) > start && number(w.timelineStart, 0) < end),
      };
    }).filter((video) => number(video.timelineAvailableEnd, 0) > start && number(video.timelineAvailableStart, 0) < end),
  };
}

async function generateJson(input: { model?: string; system: string; prompt: unknown; timeoutMs: number; numPredict: number; temperature?: number }): Promise<string> {
  return generateWithOllama({
    model: input.model ?? config.defaultModel,
    system: input.system,
    prompt: typeof input.prompt === "string" ? input.prompt : JSON.stringify(input.prompt),
    format: "json",
    timeoutMs: input.timeoutMs,
    options: { temperature: input.temperature ?? 0.25, top_p: 0.85, repeat_penalty: 1.05, num_predict: input.numPredict },
  });
}

export async function buildCreativeEditPlan(input: EditingPlannerRequest): Promise<EditingPlan> {
  if (!input.audioPath?.trim()) throw new Error("audioPath is required.");
  const included = input.clips.filter((clip) => !clip.exclude);
  if (!included.length) throw new Error("At least one non-excluded clip is required.");
  if (new Set(included.map((clip) => clip.id)).size !== included.length) throw new Error("Clip ids must be unique.");

  bootstrapEditingAcademy();
  const intent = input.userIntent ?? "Create the strongest complete performance edit from the available synchronized footage.";
  const editingKnowledge = buildEditingKnowledgeContext(intent);
  if (editingKnowledge.gap.needsMoreKnowledge) throw new Error(`Editing Academy knowledge gap: ${editingKnowledge.gap.reason} Query: ${editingKnowledge.gap.query}`);

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

  const availableEnd = Math.min(duration, Math.max(...videos.map((video) => number(video.timelineAvailableEnd, 0))));
  const allowedClipIds = new Set(included.map((clip) => clip.id));
  const summaries = videos.map((video) => ({
    id: video.id,
    timelineAvailableStart: video.timelineAvailableStart,
    timelineAvailableEnd: video.timelineAvailableEnd,
    summary: video.summary,
    qualityFlags: video.qualityFlags,
  }));

  const briefSystem = `You are FREEOS's senior editing director. Return valid JSON only. Build a concise creative direction from the user's intent, owner-approved Editing Academy guidance, song-level evidence, and camera summaries. Do not output cuts yet. Do not invent footage, lyrics, or musical structure. The academy is judgment guidance, not a preset. Required shape: {"creativeSummary":string,"principles":[string],"cautions":[string]}.\n\n${editingKnowledge.context}`;
  const briefText = await generateJson({
    system: briefSystem,
    prompt: {
      project: input.project,
      sequence: input.sequence,
      userIntent: intent,
      durationSeconds: duration,
      editableDurationSeconds: availableEnd,
      audio: { tempo: audio.tempo, loudness: audio.loudness, sections: audio.sections, silenceRegions: audio.silenceRegions, intro: audio.intro, outro: audio.outro },
      clips: summaries,
    },
    timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000),
    numPredict: 900,
    temperature: 0.3,
  });
  const brief = parseCreativeBrief(briefText);

  const sectionSeconds = 48;
  const decisions: EditingDecision[] = [];
  const sectionCautions: string[] = [];
  let previousClipId = "";
  for (let sectionStart = 0; sectionStart < availableEnd; sectionStart += sectionSeconds) {
    const sectionEnd = Math.min(availableEnd, sectionStart + sectionSeconds);
    const evidence = sectionEvidence(audio, videos, sectionStart, sectionEnd);
    const sectionSystem = `You are FREEOS's section editor. Return valid JSON only. Make the actual creative edit decisions for ONLY timeline ${sectionStart.toFixed(3)} to ${sectionEnd.toFixed(3)} seconds. Use the creative direction and measured section evidence. Apply Editing Academy principles as judgment, never as fixed rules. Do not mechanically cut on beats, alternate cameras, or rank shots by one metric. Use absolute timeline seconds. Respect every clip's availability. Continue naturally from previousClipId when useful, but change when the performance, visual role, contrast, musical phrase, or creative direction motivates it. Do not invent visual content, lyrics, sync, or musical events. Required shape: {"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string]}. Decisions must be chronological, non-overlapping, and cover this section as completely as available evidence permits. Keep rationales short.`;
    const sectionPrompt = {
      userIntent: intent,
      creativeBrief: brief,
      previousClipId: previousClipId || null,
      editingKnowledgeCompetencies: editingKnowledge.gap.relevantCompetencies,
      evidence,
    };

    let sectionText = await generateJson({
      system: sectionSystem,
      prompt: sectionPrompt,
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 150_000),
      numPredict: 1400,
      temperature: 0.3,
    });

    let sectionDecisions: EditingDecision[];
    try {
      sectionDecisions = parseSectionDecisions(sectionText, allowedClipIds, sectionStart, sectionEnd, videos);
    } catch (error) {
      console.error(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} response excerpt:`, sectionText.slice(0, 1600));
      sectionText = await generateJson({
        system: `Return valid JSON only. Repair this section edit plan. Preserve its creative intent. Use only clip ids ${included.map((clip) => clip.id).join(", ")}. All decisions must stay within ${sectionStart}-${sectionEnd} absolute timeline seconds, be chronological and non-overlapping, and respect source availability. Required shape: {"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string]}.`,
        prompt: sectionText.slice(0, 8000),
        timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 90_000),
        numPredict: 1000,
        temperature: 0.1,
      });
      sectionDecisions = parseSectionDecisions(sectionText, allowedClipIds, sectionStart, sectionEnd, videos);
    }

    const parsedSection = asObject(JSON.parse(sectionText), "section plan");
    if (Array.isArray(parsedSection.cautions)) sectionCautions.push(...parsedSection.cautions.filter((v): v is string => typeof v === "string"));
    decisions.push(...sectionDecisions);
    previousClipId = sectionDecisions.at(-1)?.clipId ?? previousClipId;
  }

  for (let i = 1; i < decisions.length; i++) {
    if (decisions[i].start < decisions[i - 1].end - 0.01) throw new Error(`Combined planner decisions overlap near ${decisions[i].start}.`);
  }

  const cautions = Array.from(new Set([
    ...brief.cautions,
    ...sectionCautions,
    ...(availableEnd < duration - 0.05 ? [`No supplied video source covers the final ${(duration - availableEnd).toFixed(2)} seconds of the requested duration; FREEOS did not invent coverage.`] : []),
  ])).slice(0, 50);

  return {
    version: "freeos-creative-planner-v2-staged",
    durationSeconds: duration,
    creativeSummary: brief.creativeSummary,
    decisions,
    cautions,
    evidence: {
      audioAnalysisVersion: typeof audio.analysisVersion === "string" ? audio.analysisVersion : undefined,
      videoAnalysisVersions: Object.fromEntries(videos.map((video) => [String(video.id), typeof video.analysisVersion === "string" ? video.analysisVersion : undefined])),
      editingKnowledgeUnits: editingKnowledge.gap.relevantUnits,
      editingKnowledgeGap: editingKnowledge.gap.needsMoreKnowledge,
      plannerMode: "academy-guided-staged",
    },
  };
}
