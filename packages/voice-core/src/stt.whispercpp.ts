import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { getVoiceConfig } from "./voice.config";
import { prepareWhisperAudio } from "./audio.convert";
import type { TranscriptionResult } from "./voice.types";

function run(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `whisper.cpp exited with code ${code}.`)));
  });
}

export async function transcribeWithWhisperCpp(audioPath: string): Promise<TranscriptionResult> {
  const config = getVoiceConfig();
  const configured = Boolean(config.whisperCppPath && config.whisperModelPath && existsSync(config.whisperCppPath) && existsSync(config.whisperModelPath));
  if (!configured) return { status: "setup-needed", configured: false, engine: "whispercpp", transcript: null, message: "Recording saved; local STT is not configured yet." };
  const outputPrefix = `${audioPath}.transcript`;
  let prepared: { audioPath: string; temporary: boolean } | null = null;
  try {
    prepared = await prepareWhisperAudio(audioPath);
    await run(config.whisperCppPath!, ["-m", config.whisperModelPath!, "-f", prepared.audioPath, "-otxt", "-of", outputPrefix]);
    const transcriptPath = `${outputPrefix}.txt`;
    const transcript = existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8").trim() : "";
    if (existsSync(transcriptPath)) rmSync(transcriptPath);
    if (!transcript) throw new Error("The local STT engine returned an empty transcript.");
    return { status: "completed", configured: true, engine: "whispercpp", transcript, message: "Audio transcribed locally." };
  } catch (error) {
    return { status: "failed", configured: true, engine: "whispercpp", transcript: null, message: error instanceof Error ? error.message : "Local transcription failed." };
  } finally {
    if (prepared?.temporary && existsSync(prepared.audioPath)) rmSync(prepared.audioPath);
  }
}
