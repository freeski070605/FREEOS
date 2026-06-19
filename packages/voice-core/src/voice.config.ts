import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { VoiceConfiguration, VoiceStatus } from "./voice.types";
import dotenv from "dotenv";

function findRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "freeos") return current;
    } catch { /* continue upward */ }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

const enabled = (value: string | undefined, fallback: boolean) => value == null ? fallback : /^(1|true|yes|on)$/i.test(value.trim());
const optionalPath = (root: string, value: string | undefined): string | null => value?.trim() ? resolve(root, value.trim()) : null;

export function getVoiceConfig(): VoiceConfiguration {
  const rootDir = resolve(process.env.FREEOS_ROOT ?? findRoot());
  dotenv.config({ path: join(rootDir, ".env"), override: false });
  return {
    rootDir,
    enabled: enabled(process.env.VOICE_ENABLED, true),
    state: enabled(process.env.VOICE_ENABLED, true) ? "idle" : "disabled",
    localOnly: true,
    recordingsDir: resolve(rootDir, process.env.VOICE_RECORDINGS_DIR?.trim() || "data/voice/recordings"),
    outputDir: resolve(rootDir, process.env.VOICE_OUTPUT_DIR?.trim() || "data/voice/output"),
    transcriptsDir: resolve(rootDir, "data/voice/transcripts"),
    sttEngine: process.env.VOICE_STT_ENGINE?.trim().toLowerCase() || "whispercpp",
    ttsEngine: process.env.VOICE_TTS_ENGINE?.trim().toLowerCase() || "windows",
    whisperCppPath: optionalPath(rootDir, process.env.WHISPER_CPP_PATH),
    whisperModelPath: optionalPath(rootDir, process.env.WHISPER_MODEL_PATH),
    whisperModelFastPath: optionalPath(rootDir, process.env.WHISPER_MODEL_FAST_PATH),
    whisperModelBalancedPath: optionalPath(rootDir, process.env.WHISPER_MODEL_BALANCED_PATH),
    whisperModelQualityPath: optionalPath(rootDir, process.env.WHISPER_MODEL_QUALITY_PATH),
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
    piperPath: optionalPath(rootDir, process.env.PIPER_PATH),
    piperModelPath: optionalPath(rootDir, process.env.PIPER_MODEL_PATH),
    piperVoiceName: process.env.PIPER_VOICE_NAME?.trim() || null,
  };
}

export function getVoiceStatus(): VoiceStatus {
  const config = getVoiceConfig();
  const sttConfigured = config.enabled && config.sttEngine === "whispercpp" && Boolean(config.whisperCppPath && config.whisperModelPath && existsSync(config.whisperCppPath) && existsSync(config.whisperModelPath));
  const windowsAvailable = process.platform === "win32";
  const piperAvailable = Boolean(config.piperPath && config.piperModelPath && existsSync(config.piperPath) && existsSync(config.piperModelPath));
  const ttsConfigured = config.enabled && (config.ttsEngine === "windows" ? windowsAvailable : config.ttsEngine === "piper" ? piperAvailable : false);
  return {
    phase: "Phase 4 — Voice Input/Output",
    voiceEnabled: config.enabled,
    sttEngine: config.sttEngine,
    sttConfigured,
    ttsEngine: config.ttsEngine,
    ttsConfigured,
    recordingsDir: relative(config.rootDir, config.recordingsDir).replace(/\\/g, "/"),
    outputDir: relative(config.rootDir, config.outputDir).replace(/\\/g, "/"),
    paidApiKeysRequired: false,
    alwaysListening: false,
    dangerousActionsEnabled: false,
    message: !config.enabled ? "Voice is disabled." : undefined,
  };
}
