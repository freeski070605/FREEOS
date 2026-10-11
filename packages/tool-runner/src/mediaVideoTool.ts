import { ToolRunnerError } from "./tool.types";

type Analyzer = (path:string, sampleFps?:number) => Promise<unknown>;
let analyzer: Analyzer | undefined;

export function registerMediaVideoAnalyzer(fn:Analyzer):void { analyzer=fn; }

export async function executeMediaVideoTool(args:Record<string,unknown>):Promise<unknown> {
  if (typeof args.path!=="string" || !args.path.trim()) throw new ToolRunnerError("media.video.analyze requires a path.","validation");
  const sampleFps = args.sampleFps === undefined ? undefined : Number(args.sampleFps);
  if (sampleFps !== undefined && (!Number.isFinite(sampleFps) || sampleFps < .25 || sampleFps > 6)) throw new ToolRunnerError("media.video.analyze sampleFps must be between 0.25 and 6.","validation");
  if (!analyzer) throw new ToolRunnerError("Adobe video analyzer is not connected.","conflict");
  try { return await analyzer(args.path,sampleFps); }
  catch (error) { throw new ToolRunnerError(`media.video.analyze failed: ${error instanceof Error ? error.message : String(error)}`,"validation"); }
}
