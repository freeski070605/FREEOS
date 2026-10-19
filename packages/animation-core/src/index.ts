export type AnimationQualityMode = "preview" | "local-final" | "ultra";
export type ShotScale = "close-up" | "medium-close" | "medium" | "full" | "wide" | "unknown";
export type FramingRole = "intimate" | "performance" | "environmental-or-undetected";
export type MotionRole = "static" | "camera-motion" | "subject-motion" | "mixed-motion";

export interface VideoFrameEvidenceLike {
  time: number;
  motion: number;
  sceneChange: number;
  faceCount: number;
  personCount: number;
  globalMotion: number;
  localMotion: number;
  shotScale: ShotScale;
  framingRole: FramingRole;
  motionRole: MotionRole;
}

export interface VideoQualityFlagLike {
  start: number;
  end: number;
  kind: "blur" | "underexposed" | "overexposed";
  severity: number;
}

export interface VideoAnalysisLike {
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  timeline: VideoFrameEvidenceLike[];
  sceneChanges: Array<{ time: number; strength: number }>;
  qualityFlags: VideoQualityFlagLike[];
  semanticNotes?: string[];
}

export interface CharacterBibleRef {
  id: string;
  referenceImages: string[];
  approvedDesignImage?: string;
  notes?: string[];
}

export interface StyleBibleRef {
  id: string;
  prompt: string;
  negativePrompt?: string;
  referenceImages?: string[];
}

export interface AnimationShot {
  id: string;
  start: number;
  end: number;
  duration: number;
  controlWindow: { start: number; end: number };
  referenceFrameTimes: number[];
  shotScale: ShotScale;
  framingRole: FramingRole;
  motionRole: MotionRole;
  facePresence: number;
  personPresence: number;
  averageMotion: number;
  controls: {
    depth: true;
    pose: boolean;
    segmentation: boolean;
    faceReference: boolean;
    cameraMotion: boolean;
  };
  generation: { width: number; height: number; fps: number };
  delivery: { width: number; height: number; fps: number };
  warnings: Array<{ kind: VideoQualityFlagLike["kind"]; severity: number }>;
}

export interface AnimationPlan {
  version: "freeos-animation-plan-v1";
  projectId: string;
  sourcePath: string;
  qualityMode: AnimationQualityMode;
  source: { width: number; height: number; fps: number; durationSeconds: number };
  characterBible?: CharacterBibleRef;
  styleBible?: StyleBibleRef;
  shots: AnimationShot[];
  renderStrategy: {
    engine: "comfyui";
    workflowFamily: "wan-vace-video-to-video";
    preserveOriginalAudio: true;
    overlapSeconds: number;
    selectiveRerender: true;
    localFirst: true;
  };
  notes: string[];
}

export interface AnimationPlanOptions {
  projectId?: string;
  qualityMode?: AnimationQualityMode;
  minShotSeconds?: number;
  maxShotSeconds?: number;
  overlapSeconds?: number;
  sceneChangeThreshold?: number;
  characterBible?: CharacterBibleRef;
  styleBible?: StyleBibleRef;
}

function finitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "animation-project";
}

function dominant<T extends string>(values: T[], fallback: T): T {
  if (!values.length) return fallback;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function multipleOf16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}

export function animationDimensions(width: number, height: number, mode: AnimationQualityMode): { width: number; height: number } {
  finitePositive(width, "width");
  finitePositive(height, "height");
  const shortTarget = mode === "preview" ? 256 : mode === "local-final" ? 480 : 720;
  const longCap = mode === "preview" ? 448 : mode === "local-final" ? 848 : 1280;
  const landscape = width >= height;
  const sourceShort = Math.min(width, height);
  const sourceLong = Math.max(width, height);
  const scale = shortTarget / sourceShort;
  const long = Math.min(longCap, sourceLong * scale);
  const short = shortTarget;
  return landscape
    ? { width: multipleOf16(long), height: multipleOf16(short) }
    : { width: multipleOf16(short), height: multipleOf16(long) };
}

export function deliveryDimensions(width: number, height: number): { width: number; height: number } {
  finitePositive(width, "width");
  finitePositive(height, "height");
  const landscape = width >= height;
  const shortTarget = 1080;
  const scale = shortTarget / Math.min(width, height);
  const long = Math.round(Math.max(width, height) * scale);
  return landscape ? { width: long, height: shortTarget } : { width: shortTarget, height: long };
}

function buildBoundaries(analysis: VideoAnalysisLike, minShot: number, maxShot: number, threshold: number): number[] {
  const duration = analysis.durationSeconds;
  const sceneTimes = analysis.sceneChanges
    .filter(change => Number.isFinite(change.time) && change.time > 0 && change.time < duration && change.strength >= threshold)
    .map(change => change.time)
    .sort((a, b) => a - b);

  const accepted: number[] = [0];
  for (const time of sceneTimes) {
    if (time - accepted[accepted.length - 1] >= minShot) accepted.push(time);
  }
  if (duration - accepted[accepted.length - 1] < minShot && accepted.length > 1) accepted.pop();
  accepted.push(duration);

  const expanded: number[] = [accepted[0]];
  for (let index = 1; index < accepted.length; index += 1) {
    const start = expanded[expanded.length - 1];
    const end = accepted[index];
    const length = end - start;
    if (length > maxShot) {
      const pieces = Math.ceil(length / maxShot);
      for (let piece = 1; piece < pieces; piece += 1) expanded.push(start + (length * piece) / pieces);
    }
    expanded.push(end);
  }
  return expanded.map(round3);
}

function referenceTimes(start: number, end: number): number[] {
  const duration = end - start;
  const inset = Math.min(0.12, duration * 0.1);
  return [start + inset, start + duration / 2, end - inset]
    .map(round3)
    .filter((time, index, all) => time >= start && time <= end && all.indexOf(time) === index);
}

export function buildAnimationPlan(analysis: VideoAnalysisLike, options: AnimationPlanOptions = {}): AnimationPlan {
  if (!analysis || typeof analysis !== "object") throw new Error("Video analysis is required.");
  if (!analysis.path?.trim()) throw new Error("Video analysis path is required.");
  finitePositive(analysis.durationSeconds, "durationSeconds");
  finitePositive(analysis.width, "width");
  finitePositive(analysis.height, "height");
  finitePositive(analysis.fps, "fps");
  if (!Array.isArray(analysis.timeline) || !Array.isArray(analysis.sceneChanges) || !Array.isArray(analysis.qualityFlags)) {
    throw new Error("Video analysis evidence is incomplete.");
  }

  const qualityMode = options.qualityMode ?? "local-final";
  const minShot = options.minShotSeconds ?? 1;
  const maxShot = options.maxShotSeconds ?? (qualityMode === "preview" ? 4 : 5);
  const overlap = options.overlapSeconds ?? 0.35;
  const threshold = options.sceneChangeThreshold ?? 0.35;
  finitePositive(minShot, "minShotSeconds");
  finitePositive(maxShot, "maxShotSeconds");
  if (maxShot < minShot) throw new Error("maxShotSeconds must be greater than or equal to minShotSeconds.");
  if (!Number.isFinite(overlap) || overlap < 0 || overlap > 2) throw new Error("overlapSeconds must be between 0 and 2 seconds.");
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("sceneChangeThreshold must be between 0 and 1.");

  const generation = animationDimensions(analysis.width, analysis.height, qualityMode);
  const delivery = deliveryDimensions(analysis.width, analysis.height);
  const boundaries = buildBoundaries(analysis, minShot, maxShot, threshold);
  const shots: AnimationShot[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const evidence = analysis.timeline.filter(frame => frame.time >= start && frame.time < end);
    const facePresence = evidence.length ? evidence.filter(frame => frame.faceCount > 0).length / evidence.length : 0;
    const personPresence = evidence.length ? evidence.filter(frame => frame.personCount > 0).length / evidence.length : 0;
    const motionRole = dominant(evidence.map(frame => frame.motionRole), "static" as MotionRole);
    const warnings = analysis.qualityFlags
      .filter(flag => flag.end > start && flag.start < end)
      .map(flag => ({ kind: flag.kind, severity: Math.max(0, Math.min(1, flag.severity)) }));

    shots.push({
      id: `shot-${String(index + 1).padStart(3, "0")}`,
      start,
      end,
      duration: round3(end - start),
      controlWindow: { start: round3(Math.max(0, start - overlap)), end: round3(Math.min(analysis.durationSeconds, end + overlap)) },
      referenceFrameTimes: referenceTimes(start, end),
      shotScale: dominant(evidence.map(frame => frame.shotScale), "unknown" as ShotScale),
      framingRole: dominant(evidence.map(frame => frame.framingRole), "environmental-or-undetected" as FramingRole),
      motionRole,
      facePresence: round3(facePresence),
      personPresence: round3(personPresence),
      averageMotion: round3(average(evidence.map(frame => frame.motion))),
      controls: {
        depth: true,
        pose: personPresence >= 0.25,
        segmentation: personPresence >= 0.15,
        faceReference: facePresence >= 0.15,
        cameraMotion: motionRole === "camera-motion" || motionRole === "mixed-motion",
      },
      generation: { ...generation, fps: analysis.fps },
      delivery: { ...delivery, fps: analysis.fps },
      warnings,
    });
  }

  return {
    version: "freeos-animation-plan-v1",
    projectId: slugify(options.projectId ?? analysis.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "animation-project"),
    sourcePath: analysis.path,
    qualityMode,
    source: { width: analysis.width, height: analysis.height, fps: analysis.fps, durationSeconds: analysis.durationSeconds },
    ...(options.characterBible ? { characterBible: options.characterBible } : {}),
    ...(options.styleBible ? { styleBible: options.styleBible } : {}),
    shots,
    renderStrategy: {
      engine: "comfyui",
      workflowFamily: "wan-vace-video-to-video",
      preserveOriginalAudio: true,
      overlapSeconds: overlap,
      selectiveRerender: true,
      localFirst: true,
    },
    notes: [
      "Generate from control video plus locked character/style references; do not use a frame-by-frame cartoon filter.",
      "Render shots independently with overlap, then inspect continuity before assembly.",
      "Keep source audio untouched and remux it after final picture assembly.",
      ...(analysis.semanticNotes ?? []),
    ],
  };
}

export interface AnimationRenderJob {
  id: string;
  projectId: string;
  shotId: string;
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  controlStart: number;
  controlEnd: number;
  generation: AnimationShot["generation"];
  delivery: AnimationShot["delivery"];
  controls: AnimationShot["controls"];
  referenceFrameTimes: number[];
  outputPrefix: string;
  characterBible?: CharacterBibleRef;
  styleBible?: StyleBibleRef;
}

export function createRenderJobs(plan: AnimationPlan): AnimationRenderJob[] {
  return plan.shots.map(shot => ({
    id: `${plan.projectId}-${shot.id}`,
    projectId: plan.projectId,
    shotId: shot.id,
    sourcePath: plan.sourcePath,
    sourceStart: shot.start,
    sourceEnd: shot.end,
    controlStart: shot.controlWindow.start,
    controlEnd: shot.controlWindow.end,
    generation: shot.generation,
    delivery: shot.delivery,
    controls: shot.controls,
    referenceFrameTimes: shot.referenceFrameTimes,
    outputPrefix: `generated/animation/${plan.projectId}/shots/${shot.id}`,
    ...(plan.characterBible ? { characterBible: plan.characterBible } : {}),
    ...(plan.styleBible ? { styleBible: plan.styleBible } : {}),
  }));
}

export function validateLocalComfyEndpoint(raw = process.env.FREEOS_COMFYUI_URL || "http://127.0.0.1:8188"): string {
  const url = new URL(raw);
  if (url.protocol !== "http:") throw new Error("ComfyUI endpoint must use local HTTP.");
  if (url.username || url.password) throw new Error("ComfyUI endpoint credentials are not accepted in the URL.");
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new Error("FREEOS animation only permits a loopback ComfyUI endpoint.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export interface ComfyStatus {
  available: boolean;
  endpoint: string;
  reason?: string;
}

export async function comfyStatus(endpoint?: string, timeoutMs = 5000): Promise<ComfyStatus> {
  const local = validateLocalComfyEndpoint(endpoint);
  try {
    const response = await fetch(`${local}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { available: false, endpoint: local, reason: `ComfyUI returned HTTP ${response.status}.` };
    return { available: true, endpoint: local };
  } catch (error) {
    return { available: false, endpoint: local, reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface ComfyQueueResult {
  promptId: string;
  endpoint: string;
}

export async function queueComfyWorkflow(workflow: Record<string, unknown>, options: { endpoint?: string; clientId?: string; timeoutMs?: number } = {}): Promise<ComfyQueueResult> {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow) || !Object.keys(workflow).length) {
    throw new Error("A non-empty ComfyUI API workflow object is required.");
  }
  const endpoint = validateLocalComfyEndpoint(options.endpoint);
  const response = await fetch(`${endpoint}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, ...(options.clientId ? { client_id: options.clientId } : {}) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
  });
  if (!response.ok) throw new Error(`ComfyUI queue request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const value = await response.json() as { prompt_id?: unknown };
  if (typeof value.prompt_id !== "string" || !value.prompt_id) throw new Error("ComfyUI response did not include prompt_id.");
  return { promptId: value.prompt_id, endpoint };
}

export async function comfyPromptHistory(promptId: string, options: { endpoint?: string; timeoutMs?: number } = {}): Promise<unknown> {
  if (!promptId?.trim()) throw new Error("ComfyUI prompt id is required.");
  const endpoint = validateLocalComfyEndpoint(options.endpoint);
  const response = await fetch(`${endpoint}/history/${encodeURIComponent(promptId.trim())}`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
  });
  if (!response.ok) throw new Error(`ComfyUI history request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

export * from "./workflow";
