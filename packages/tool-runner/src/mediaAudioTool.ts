type Analyzer = (path: string) => Promise<unknown>;
let analyzer: Analyzer | undefined;
export function registerMediaAudioAnalyzer(fn: Analyzer): void { analyzer = fn; }
export async function executeMediaAudioTool(args: Record<string, unknown>): Promise<unknown> {
  if (typeof args.path !== "string" || !args.path.trim()) throw new Error("media.audio.analyze requires a path.");
  if (!analyzer) throw new Error("Adobe audio analyzer is not connected.");
  return analyzer(args.path);
}
