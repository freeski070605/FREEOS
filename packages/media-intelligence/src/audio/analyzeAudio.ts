import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseAudioAnalysis, type AudioAnalysis } from "./types";

const extensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".mov", ".mp4"]);
const script = resolve(__dirname, "../../python/audio_analyze.py");

function normalizeInputPath(input: string): string {
  let value = input.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
  }
  value = value.replace(/[\u0000-\u001F]+$/g, "").trim();
  return value;
}

export function audioBackendStatus(options: { python?: string; ffmpeg?: string; ffprobe?: string } = {}) {
  const python = options.python || process.env.FREEOS_AUDIO_PYTHON || resolve(__dirname, "../../.venv/Scripts/python.exe");
  const ffmpeg = options.ffmpeg || process.env.FREEOS_FFMPEG_PATH || "ffmpeg";
  const ffprobe = options.ffprobe || process.env.FREEOS_FFPROBE_PATH || (process.env.FREEOS_FFMPEG_PATH ? resolve(process.env.FREEOS_FFMPEG_PATH, "../ffprobe.exe") : "ffprobe");
  const check = (exe: string, args: string[]) => spawnSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 100000 });
  for (const [name, exe, args] of [["Python audio backend", python, [script, "--doctor"]], ["ffmpeg", ffmpeg, ["-version"]], ["ffprobe", ffprobe, ["-version"]]] as const) {
    const result = check(exe, [...args]);
    if (result.status !== 0) return { available: false, reason: `${name} unavailable: ${(result.stderr || result.error?.message || "missing executable or dependencies").trim().slice(0, 300)}`, python, ffmpeg, ffprobe };
  }
  return { available: true, python, ffmpeg, ffprobe };
}

export function runBounded(exe: string, args: string[], timeoutMs: number, maxBytes: number): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(exe, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "", settled = false;
    const fail = (message: string) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); reject(new Error(message)); };
    const timer = setTimeout(() => fail("Audio analysis timed out."), timeoutMs);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (part: string) => { output += part; if (Buffer.byteLength(output) > maxBytes) fail("Audio analysis output exceeded limit."); });
    child.stderr.on("data", (part: string) => { error = (error + part).slice(-8000); });
    child.on("error", e => fail(`Audio analyzer could not start: ${e.message}`));
    child.on("close", code => { if (settled) return; settled = true; clearTimeout(timer); if (code !== 0) reject(new Error(`Audio analysis failed: ${error.trim().slice(-1000) || `exit ${code}`}`)); else resolveResult(output); });
  });
}

export async function analyzeAudio(path: string, options: { python?: string; ffmpeg?: string; ffprobe?: string; timeoutMs?: number } = {}): Promise<AudioAnalysis> {
  const normalized = normalizeInputPath(path);
  const file = resolve(normalized);
  const extension = extname(file).toLowerCase();
  if (!extensions.has(extension)) throw new Error(`Unsupported audio/video extension '${extension || "(none)"}' for path: ${JSON.stringify(normalized)}`);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Audio/media file does not exist: ${file}`);
  const backend = audioBackendStatus(options);
  if (!backend.available) throw new Error(backend.reason);
  const probe = JSON.parse(await runBounded(backend.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], 30000, 2_000_000));
  const stream = probe.streams?.find((s: any) => s.codec_type === "audio");
  if (!stream) throw new Error("Media file has no audio stream.");
  const duration = Number(stream.duration || probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) throw new Error("Audio duration must be known and at most two hours.");
  const raw = await runBounded(backend.python, [script, file, backend.ffmpeg, String(duration), String(stream.sample_rate || 0), String(stream.channels || 0)], options.timeoutMs ?? 600000, 8_000_000);
  return parseAudioAnalysis(JSON.parse(raw));
}
