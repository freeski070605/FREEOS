import type { AnimationRenderJob } from "./index";

export type ComfyBindingSource =
  | "controlVideo"
  | "characterReference"
  | "styleReference"
  | "positivePrompt"
  | "negativePrompt"
  | "width"
  | "height"
  | "fps"
  | "controlFrameCount"
  | "shotFrameCount"
  | "trimStartFrames"
  | "trimEndFrames"
  | "seed"
  | "outputPrefix";

export interface ComfyWorkflowAssignment {
  nodeId: string;
  input: string;
  source: ComfyBindingSource;
  required?: boolean;
}

export interface ComfyWorkflowBinding {
  version: "freeos-comfy-binding-v1";
  workflowFamily: "wan-vace-video-to-video";
  assignments: ComfyWorkflowAssignment[];
}

export interface ComfyWorkflowBindContext {
  job: AnimationRenderJob;
  controlVideo: string;
  characterReference?: string;
  styleReference?: string;
  positivePrompt?: string;
  negativePrompt?: string;
  outputPrefix?: string;
  seed?: number;
}

export interface ComfyOutputFile {
  nodeId: string;
  filename: string;
  subfolder?: string;
  type?: string;
}

function safeKey(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (["__proto__", "prototype", "constructor"].includes(trimmed)) {
    throw new Error(`${label} '${trimmed}' is not allowed.`);
  }
  return trimmed;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
  return Math.max(1, Math.round(value));
}

function frameCount(seconds: number, fps: number): number {
  return positiveInteger(seconds * fps, "frame count");
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sourceValue(source: ComfyBindingSource, context: ComfyWorkflowBindContext): unknown {
  const { job } = context;
  const fps = job.generation.fps;
  switch (source) {
    case "controlVideo":
      return optionalText(context.controlVideo);
    case "characterReference":
      return optionalText(context.characterReference);
    case "styleReference":
      return optionalText(context.styleReference);
    case "positivePrompt":
      return optionalText(context.positivePrompt);
    case "negativePrompt":
      return optionalText(context.negativePrompt);
    case "width":
      return positiveInteger(job.generation.width, "generation width");
    case "height":
      return positiveInteger(job.generation.height, "generation height");
    case "fps":
      return Number.isInteger(fps) ? fps : Number(fps.toFixed(3));
    case "controlFrameCount":
      return frameCount(job.controlEnd - job.controlStart, fps);
    case "shotFrameCount":
      return frameCount(job.sourceEnd - job.sourceStart, fps);
    case "trimStartFrames":
      return Math.max(0, Math.round((job.sourceStart - job.controlStart) * fps));
    case "trimEndFrames":
      return Math.max(0, Math.round((job.controlEnd - job.sourceEnd) * fps));
    case "seed":
      return Number.isSafeInteger(context.seed) ? context.seed : undefined;
    case "outputPrefix":
      return optionalText(context.outputPrefix ?? job.outputPrefix)?.replace(/\\/g, "/");
  }
}

function assertWorkflowObject(value: Record<string, unknown>): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
    throw new Error("A non-empty ComfyUI API workflow object is required.");
  }
}

export function validateComfyWorkflowBinding(binding: ComfyWorkflowBinding): void {
  if (!binding || typeof binding !== "object") throw new Error("ComfyUI workflow binding is required.");
  if (binding.version !== "freeos-comfy-binding-v1") throw new Error(`Unsupported workflow binding version '${String(binding.version)}'.`);
  if (binding.workflowFamily !== "wan-vace-video-to-video") throw new Error(`Unsupported workflow family '${String(binding.workflowFamily)}'.`);
  if (!Array.isArray(binding.assignments) || !binding.assignments.length) throw new Error("Workflow binding assignments are required.");

  const seen = new Set<string>();
  for (const assignment of binding.assignments) {
    const nodeId = safeKey(assignment.nodeId, "Workflow binding nodeId");
    const input = safeKey(assignment.input, "Workflow binding input");
    if (!assignment.source) throw new Error(`Workflow binding ${nodeId}.${input} is missing a source.`);
    const signature = `${nodeId}\u0000${input}`;
    if (seen.has(signature)) throw new Error(`Workflow binding assigns ${nodeId}.${input} more than once.`);
    seen.add(signature);
  }
}

export function bindComfyWorkflow(
  workflowTemplate: Record<string, unknown>,
  binding: ComfyWorkflowBinding,
  context: ComfyWorkflowBindContext,
): Record<string, unknown> {
  assertWorkflowObject(workflowTemplate);
  validateComfyWorkflowBinding(binding);
  if (!context?.job) throw new Error("Animation render job is required for workflow binding.");

  const workflow = structuredClone(workflowTemplate) as Record<string, unknown>;
  for (const assignment of binding.assignments) {
    const nodeId = safeKey(assignment.nodeId, "Workflow binding nodeId");
    const input = safeKey(assignment.input, "Workflow binding input");
    const node = workflow[nodeId];
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error(`Workflow node '${nodeId}' was not found.`);
    }
    const nodeRecord = node as Record<string, unknown>;
    const inputs = nodeRecord.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
      throw new Error(`Workflow node '${nodeId}' does not contain an inputs object.`);
    }
    const value = sourceValue(assignment.source, context);
    if (value === undefined) {
      if (assignment.required !== false) {
        throw new Error(`Workflow binding ${nodeId}.${input} requires '${assignment.source}', but no value was supplied.`);
      }
      continue;
    }
    (inputs as Record<string, unknown>)[input] = value;
  }
  return workflow;
}

export function extractComfyOutputFiles(history: unknown, promptId: string): ComfyOutputFile[] {
  if (!history || typeof history !== "object" || Array.isArray(history)) return [];
  const prompt = (history as Record<string, unknown>)[promptId];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return [];
  const outputs = (prompt as Record<string, unknown>).outputs;
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return [];

  const files: ComfyOutputFile[] = [];
  for (const [nodeId, rawNodeOutput] of Object.entries(outputs as Record<string, unknown>)) {
    if (!rawNodeOutput || typeof rawNodeOutput !== "object" || Array.isArray(rawNodeOutput)) continue;
    const nodeOutput = rawNodeOutput as Record<string, unknown>;
    for (const collectionName of ["images", "gifs", "videos"] as const) {
      const collection = nodeOutput[collectionName];
      if (!Array.isArray(collection)) continue;
      for (const rawFile of collection) {
        if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) continue;
        const file = rawFile as Record<string, unknown>;
        if (typeof file.filename !== "string" || !file.filename.trim()) continue;
        files.push({
          nodeId,
          filename: file.filename,
          ...(typeof file.subfolder === "string" && file.subfolder ? { subfolder: file.subfolder } : {}),
          ...(typeof file.type === "string" && file.type ? { type: file.type } : {}),
        });
      }
    }
  }
  return files;
}
