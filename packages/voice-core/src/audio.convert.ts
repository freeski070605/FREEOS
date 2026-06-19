import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { getVoiceConfig } from "./voice.config";

function runFfmpeg(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}.`)));
  });
}

export async function prepareWhisperAudio(inputPath: string): Promise<{ audioPath: string; temporary: boolean }> {
  const config = getVoiceConfig();
  const outputPath = `${inputPath}.whisper.wav`;
  const candidates = [config.ffmpegPath];
  if (process.platform === "win32" && config.ffmpegPath.toLowerCase() === "ffmpeg" && process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe"));
  }
  let lastError: unknown;
  for (const executable of [...new Set(candidates)]) {
    try {
      await runFfmpeg(executable, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath]);
      if (!existsSync(outputPath)) throw new Error("FFmpeg did not create the normalized WAV file.");
      return { audioPath: outputPath, temporary: true };
    } catch (error) { lastError = error; }
  }
  if (extname(inputPath).toLowerCase() === ".wav") return { audioPath: inputPath, temporary: false };
  throw new Error(`FFmpeg could not convert this recording to 16-bit WAV: ${lastError instanceof Error ? lastError.message : "conversion failed"}`);
}
