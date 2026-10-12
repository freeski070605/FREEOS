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

const creativeBriefSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["creativeSummary", "principles", "cautions"],
  properties: {
    creativeSummary: { type: "string", maxLength: 2400 },
    principles: { type: "array", maxItems: 12, items: { type: "string", maxLength: 220 } },
    cautions: { type: "array", maxItems: 20, items: { type: "string", maxLength: 220 } },
  },
};

const sectionPlanSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["decisions", "cautions"],
  properties: {
    decisions: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "clipId", "action", "confidence", "rationale"],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          clipId: { type: "string", maxLength: 120 },
          action: { type: "string", enum: ["cut", "hold", "punch-in"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", maxLength: 180 },
        },
      },
    },
    cautions: { type: "array", maxItems: 10, items: { type: "string", maxLength: 220 } },
  },
};

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

function parseSectionPlan(text: string): { decisions: unknown[]; cautions: string[] } {
  const parsed = asObject(JSON.parse(text), "section plan");
  return {
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    cautions: Array.isArray(parsed.cautions) ? parsed.cautions.filter((v): v is string => typeof v === "string") : [],
  };
}

function validateSectionDecisions(raw: unknown[], allowedClipIds: Set<string>, sectionStart: number, sectionEnd: number, videos: JsonObject[]): EditingDecision[] {
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
  const sectionAudio = audioWindows.filter((w) => number(w.end, 0) > start && number(w.start, 0) < end);
  return {
    start,
    end,
    audio: {
      tempo: audio.tempo,
      loudness: audio.loudness,
      windows: sectionAudio.map((w) => ({
        start: w.start,
        end: w.end,
        energyMean: w.energyMean,
        transientCount: w.transientCount,
        strongestTransient: w.strongestTransient,
        beatCount: w.beatCount,
      })),
    },
    clips: videos.map((video) => {
      const windows = Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
      const sectionWindows = windows.filter((w) => number(w.timelineEnd, 0) > start && number(w.timelineStart, 0) < end);
      return {
        id: video.id,
        availableStart: video.timelineAvailableStart,
        availableEnd: video.timelineAvailableEnd,
        windows: sectionWindows.map((w) => ({
          start: w.timelineStart,
          end: w.timelineEnd,
          sharpness: w.sharpness,
          brightness: w.brightness,
          motion: w.motion,
          facePresence: w.facePresence,
          multiFacePresence: w.multiFacePresence,
          primaryFaceArea: w.primaryFaceArea,
          sceneChangeMax: w.sceneChangeMax,
          underexposedFraction: w.underexposedFraction,
          overexposedFraction: w.overexposedFraction,
        })),
      };
    }).filter((video) => number(video.availableEnd, 0) > start && number(video.availableStart, 0) < end),
  };
}

async function generateJson(input: {
  model?: string;
  system: string;
  prompt: unknown;
  schema: JsonObject;
  timeoutMs: number;
  numPredict: number;
  temperature?: number;
}): Promise<string> {
  return generateWithOllama({
    model: input.model ?? config.defaultModel,
    system: input.system,
    prompt: typeof input.prompt === "string" ? input.prompt : JSON.stringify(input.prompt),
    format: input.schema,
    timeoutMs: input.timeoutMs,
    options: { temperature: input.temperature ?? 0.2, top_p: 0.82, repeat_penalty: 1.08, num_predict: input.numPredict },
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

  const briefSystem = `You are FREEOS's senior editing director. Build a concise creative direction from the user's intent, owner-approved Editing Academy guidance, song-level evidence, and camera summaries. Do not output cuts yet. Do not invent footage, lyrics, or musical structure. The academy is judgment guidance, not a preset.\n\n${editingKnowledge.context}`;
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
    schema: creativeBriefSchema,
    timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000),
    numPredict: 1000,
    temperature: 0.25,
  });
  const brief = parseCreativeBrief(briefText);

  const sectionSeconds = 48;
  const decisions: EditingDecision[] = [];
  const sectionCautions: string[] = [];
  let previousClipId = "";
  for (let sectionStart = 0; sectionStart < availableEnd; sectionStart += sectionSeconds) {
    const sectionEnd = Math.min(availableEnd, sectionStart + sectionSeconds);
    const evidence = sectionEvidence(audio, videos, sectionStart, sectionEnd);
    const availability = evidence.clips.map((clip) => ({ id: clip.id, start: clip.availableStart, end: clip.availableEnd }));
    const sectionSystem = `You are FREEOS's section editor. Make the actual creative edit decisions for ONLY timeline ${sectionStart.toFixed(3)} to ${sectionEnd.toFixed(3)} seconds. Use absolute timeline seconds. Respect every clip's supplied availability. Apply the creative brief and Editing Academy judgment, but never mechanically cut on beats, alternate cameras, or rank shots by one metric. Do not invent visual content, lyrics, sync, or musical events. The output schema is enforced externally, so output only the edit plan data and never repeat the evidence.`;
    const sectionPrompt = {
      userIntent: intent,
      creativeBrief: brief,
      previousClipId: previousClipId || null,
      availability,
      evidence,
    };

    let sectionText = await generateJson({
      system: sectionSystem,
      prompt: sectionPrompt,
      schema: sectionPlanSchema,
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000),
      numPredict: 1800,
      temperature: 0.2,
    });

    let parsedSection: { decisions: unknown[]; cautions: string[] };
    let sectionDecisions: EditingDecision[];
    try {
      parsedSection = parseSectionPlan(sectionText);
      sectionDecisions = validateSectionDecisions(parsedSection.decisions, allowedClipIds, sectionStart, sectionEnd, videos);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      console.error(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} validation failure: ${failure}`);
      console.error(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} response excerpt:`, sectionText.slice(0, 1600));
      sectionText = await generateJson({
        system: `Create a fresh section edit plan for ${sectionStart.toFixed(3)}-${sectionEnd.toFixed(3)} seconds. Use only the supplied clip ids and availability ranges. Preserve the creative brief, but do not copy the previous malformed result or repeat evidence. The output schema is enforced externally.`,
        prompt: {
          previousClipId: previousClipId || null,
          creativeBrief: brief,
          availability,
          evidence,
          previousFailure: failure,
        },
        schema: sectionPlanSchema,
        timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 150_000),
        numPredict: 1800,
        temperature: 0.05,
      });
      parsedSection = parseSectionPlan(sectionText);
      sectionDecisions = validateSectionDecisions(parsedSection.decisions, allowedClipIds, sectionStart, sectionEnd, videos);
    }

    sectionCautions.push(...parsedSection.cautions);
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
    version: "freeos-creative-planner-v3-structured",
    durationSeconds: duration,
    creativeSummary: brief.creativeSummary,
    decisions,
    cautions,
    evidence: {
      audioAnalysisVersion: typeof audio.analysisVersion === "string" ? audio.analysisVersion : undefined,
      videoAnalysisVersions: Object.fromEntries(videos.map((video) => [String(video.id), typeof video.analysisVersion === "string" ? video.analysisVersion : undefined])),
      editingKnowledgeUnits: editingKnowledge.gap.relevantUnits,
      editingKnowledgeGap: editingKnowledge.gap.needsMoreKnowledge,
      plannerMode: "academy-guided-staged-structured",
    },
  };
}
