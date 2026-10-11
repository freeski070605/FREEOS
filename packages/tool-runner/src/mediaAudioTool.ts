import { ToolRunnerError } from "./tool.types";

type Analyzer = (path: string) => Promise<unknown>;
let analyzer: Analyzer | undefined;

export function registerMediaAudioAnalyzer(fn: Analyzer): void { analyzer = fn; }

export async function executeMediaAudioTool(args: Record<string, unknown>): Promise<unknown> {
  if (typeof args.path !== "string" || !args.path.trim()) throw new ToolRunnerError("media.audio.analyze requires a path.", "validation");
  if (!analyzer) throw new ToolRunnerError("Adobe audio analyzer is not connected.", "conflict");
  try {
    return await analyzer(args.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolRunnerError(`media.audio.analyze failed: ${message}`, "validation");
  }
}
