import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { getVoiceConfig, getVoiceStatus } = require("../../packages/voice-core/dist/index.js");
const config = getVoiceConfig(); const status = getVoiceStatus();
const check = (label, path) => console.log(`[FREEOS] ${label}: ${path ? `${existsSync(path) ? "found" : "missing"} (${path})` : "not configured"}`);

console.log(`[FREEOS] Voice enabled: ${status.voiceEnabled}`);
console.log(`[FREEOS] Recordings folder: ${existsSync(config.recordingsDir) ? "ready" : "missing"} (${config.recordingsDir})`);
console.log(`[FREEOS] Output folder: ${existsSync(config.outputDir) ? "ready" : "missing"} (${config.outputDir})`);
check("WHISPER_CPP_PATH", config.whisperCppPath); check("WHISPER_MODEL_PATH", config.whisperModelPath);
check("WHISPER_MODEL_FAST_PATH", config.whisperModelFastPath);
check("WHISPER_MODEL_BALANCED_PATH", config.whisperModelBalancedPath);
check("WHISPER_MODEL_QUALITY_PATH", config.whisperModelQualityPath);
const ffmpegCandidates = [config.ffmpegPath];
if (process.platform === "win32" && config.ffmpegPath.toLowerCase() === "ffmpeg" && process.env.LOCALAPPDATA) {
  ffmpegCandidates.push(`${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\ffmpeg.exe`);
}
const ffmpegAvailable = [...new Set(ffmpegCandidates)].some((candidate) => spawnSync(candidate, ["-version"], { windowsHide: true }).status === 0);
console.log(`[FREEOS] FFMPEG_PATH: ${ffmpegAvailable ? "available" : "unavailable"} (${config.ffmpegPath})`);
check("PIPER_PATH", config.piperPath); check("PIPER_MODEL_PATH", config.piperModelPath);
if (process.platform === "win32") {
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "try { Add-Type -AssemblyName System.Speech -ErrorAction Stop; exit 0 } catch { exit 1 }"], { windowsHide: true });
  console.log(`[FREEOS] Windows System.Speech: ${probe.status === 0 ? "available" : "unavailable"}`);
}
console.log(`[FREEOS] STT ${status.sttEngine}: ${status.sttConfigured ? "configured" : "setup needed"}`);
console.log(`[FREEOS] TTS ${status.ttsEngine}: ${status.ttsConfigured ? "configured" : "setup needed"}`);
console.log("[FREEOS] Paid API keys required: false");
