import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { runBounded } from "../audio/analyzeAudio";
import { parseVideoAnalysis, type VideoAnalysis } from "./types";

const extensions = new Set([".mov", ".mp4", ".m4v", ".avi", ".mkv"]);
const script = resolve(__dirname, "../../python/video_analyze.py");

export function videoBackendStatus(options:{python?:string}={}) {
  const python = options.python || process.env.FREEOS_VIDEO_PYTHON || process.env.FREEOS_AUDIO_PYTHON || resolve(__dirname, "../../.venv/Scripts/python.exe");
  const result = spawnSync(python,[script,"--doctor"],{encoding:"utf8",windowsHide:true,timeout:10000,maxBuffer:200000});
  if (result.status!==0) return {available:false,reason:`Python video backend unavailable: ${(result.stderr || result.error?.message || "missing executable or dependencies").trim().slice(0,300)}`,python};
  return {available:true,python};
}

export async function analyzeVideo(path:string, options:{python?:string; sampleFps?:number; timeoutMs?:number}={}):Promise<VideoAnalysis> {
  const file=resolve(path.trim());
  const extension=extname(file).toLowerCase();
  if (!extensions.has(extension)) throw new Error(`Unsupported video extension '${extension || "(none)"}'.`);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Video file does not exist: ${file}`);
  const backend=videoBackendStatus(options);
  if (!backend.available) throw new Error(backend.reason);
  const sampleFps=Math.min(6,Math.max(.25,Number(options.sampleFps ?? 2)));
  const raw=await runBounded(backend.python,[script,file,String(sampleFps)],options.timeoutMs ?? 900000,24_000_000);
  return parseVideoAnalysis(JSON.parse(raw));
}
