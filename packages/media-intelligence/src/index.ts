import { spawn } from "node:child_process";

export interface RenderIssue { kind: "black-frame" | "silence"; start: number; end: number; severity: number }
export interface RenderAnalysis { issues: RenderIssue[]; stderrExcerpt: string; exitCode: number }
export function parseFfmpegReview(log: string): RenderIssue[] {
  const issues: RenderIssue[] = [];
  for (const match of log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    const start = Number(match[1]), end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) issues.push({ kind: "black-frame", start, end, severity: Math.min(1, Math.max(.2, (end-start)/.5)) });
  }
  const silenceStarts = [...log.matchAll(/silence_start:\s*([\d.]+)/g)].map(match => Number(match[1]));
  const silenceEnds = [...log.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)].map(match => Number(match[1]));
  for (let i = 0; i < Math.min(silenceStarts.length, silenceEnds.length); i++) if (silenceEnds[i] >= silenceStarts[i]) issues.push({ kind: "silence", start: silenceStarts[i], end: silenceEnds[i], severity: Math.min(1, (silenceEnds[i]-silenceStarts[i])/2) });
  return issues.sort((a,b) => a.start - b.start);
}
export function analyzeRender(ffmpeg: string, path: string, timeoutMs = 600000): Promise<RenderAnalysis> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-nostdin", "-i", path, "-vf", "blackdetect=d=0.04:pix_th=0.1", "-af", "silencedetect=noise=-50dB:d=0.15", "-f", "null", "-"], { windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let log = ""; let settled = false;
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new Error("Render analysis timed out.")); } }, timeoutMs);
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (part: string) => { log += part; if (log.length > 16_000_000) { child.kill(); if (!settled) { settled = true; clearTimeout(timer); reject(new Error("Render analysis output exceeded limit.")); } } });
    child.on("error", error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", code => { if (settled) return; settled = true; clearTimeout(timer); if (code !== 0) { reject(new Error(`ffmpeg review failed with exit code ${code}.`)); return; } resolveResult({ issues: parseFfmpegReview(log), stderrExcerpt: log.slice(-3000), exitCode: code }); });
  });
}
