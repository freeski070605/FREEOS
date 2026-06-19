import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { getVoiceConfig } from "./voice.config";
import type { SpeechResult } from "./voice.types";

export function synthesizeWithPiper(text: string, outputPath: string): Promise<SpeechResult> {
  const config = getVoiceConfig();
  const configured = Boolean(config.piperPath && config.piperModelPath && existsSync(config.piperPath) && existsSync(config.piperModelPath));
  if (!configured) return Promise.resolve({ status: "setup-needed", configured: false, engine: "piper", outputPath: null, absoluteOutputPath: null, message: "Piper is not configured. Set PIPER_PATH and PIPER_MODEL_PATH." });
  return new Promise((resolve) => {
    const child = spawn(config.piperPath!, ["--model", config.piperModelPath!, "--output_file", outputPath], { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ status: "failed", configured: true, engine: "piper", outputPath: null, absoluteOutputPath: null, message: error.message }));
    child.on("close", (code) => resolve(code === 0 && existsSync(outputPath)
      ? { status: "completed", configured: true, engine: "piper", outputPath: null, absoluteOutputPath: outputPath, message: "Speech generated locally with Piper." }
      : { status: "failed", configured: true, engine: "piper", outputPath: null, absoluteOutputPath: null, message: stderr.trim() || `Piper exited with code ${code}.` }));
    child.stdin.end(text, "utf8");
  });
}
