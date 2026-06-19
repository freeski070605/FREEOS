import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { getVoiceConfig } from "./voice.config";
import type { StoredAudio } from "./voice.types";

const allowedExtensions = new Set([".wav", ".webm", ".ogg", ".mp3", ".m4a", ".mp4", ".flac"]);
const mimeExtensions: Record<string, string> = { "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/flac": ".flac" };

export function ensureVoiceFolders(): void {
  const config = getVoiceConfig();
  [config.recordingsDir, config.outputDir, config.transcriptsDir].forEach((directory) => mkdirSync(directory, { recursive: true }));
}

export function saveUploadedRecording(buffer: Buffer, originalName = "recording.webm", mimeType = "audio/webm"): StoredAudio {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("An audio file is required.");
  if (buffer.length > 25 * 1024 * 1024) throw new Error("Audio uploads are limited to 25 MB.");
  const config = getVoiceConfig();
  ensureVoiceFolders();
  const requested = extname(originalName).toLowerCase();
  const extension = allowedExtensions.has(requested) ? requested : (mimeExtensions[mimeType.toLowerCase()] ?? ".bin");
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}${extension}`;
  const absolutePath = join(config.recordingsDir, filename);
  writeFileSync(absolutePath, buffer, { flag: "wx" });
  return { absolutePath, relativePath: relative(config.rootDir, absolutePath).replace(/\\/g, "/"), filename, mimeType };
}
