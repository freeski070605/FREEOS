import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { SpeechResult } from "./voice.types";

export function synthesizeWithWindowsTTS(text: string, outputPath: string): Promise<SpeechResult> {
  if (process.platform !== "win32") return Promise.resolve({ status: "setup-needed", configured: false, engine: "windows", outputPath: null, absoluteOutputPath: null, message: "Windows System.Speech is only available on Windows." });
  const script = "Add-Type -AssemblyName System.Speech; $t=[Console]::In.ReadToEnd(); $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.SetOutputToWaveFile($env:FREEOS_TTS_OUTPUT); $s.Speak($t) } finally { $s.Dispose() }";
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, FREEOS_TTS_OUTPUT: outputPath } });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ status: "failed", configured: true, engine: "windows", outputPath: null, absoluteOutputPath: null, message: error.message }));
    child.on("close", (code) => resolve(code === 0 && existsSync(outputPath)
      ? { status: "completed", configured: true, engine: "windows", outputPath: null, absoluteOutputPath: outputPath, message: "Speech generated locally with Windows TTS." }
      : { status: "failed", configured: true, engine: "windows", outputPath: null, absoluteOutputPath: null, message: stderr.trim() || `Windows TTS exited with code ${code}.` }));
    child.stdin.end(text, "utf8");
  });
}
