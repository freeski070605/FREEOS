import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ensureVoiceFolders } from "./audioStorage";
import { getVoiceConfig, getVoiceStatus } from "./voice.config";
import { transcribeWithWhisperCpp } from "./stt.whispercpp";
import { synthesizeWithPiper } from "./tts.piper";
import { synthesizeWithWindowsTTS } from "./tts.windows";
import type { SpeechResult, TranscriptionResult, VoiceSession } from "./voice.types";

type Row = Record<string, unknown>;
type SessionPatch = Partial<Pick<VoiceSession, "status" | "inputText" | "transcript" | "responseText" | "audioInputPath" | "audioOutputPath" | "sttEngine" | "ttsEngine">>;

const sessionFromRow = (row: Row): VoiceSession => ({
  id: Number(row.id), mode: String(row.mode), status: String(row.status),
  inputText: row.input_text == null ? null : String(row.input_text), transcript: row.transcript == null ? null : String(row.transcript),
  responseText: row.response_text == null ? null : String(row.response_text), audioInputPath: row.audio_input_path == null ? null : String(row.audio_input_path),
  audioOutputPath: row.audio_output_path == null ? null : String(row.audio_output_path), sttEngine: row.stt_engine == null ? null : String(row.stt_engine),
  ttsEngine: row.tts_engine == null ? null : String(row.tts_engine), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
});

export class VoiceService {
  readonly config = getVoiceConfig();
  readonly databasePath = join(this.config.rootDir, "data", "freeos.sqlite");
  readonly #database: Database.Database;

  constructor() {
    ensureVoiceFolders();
    this.#database = new Database(this.databasePath);
    this.#database.pragma("foreign_keys = ON");
    this.initialize();
  }

  initialize(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS voice_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, status TEXT NOT NULL, input_text TEXT, transcript TEXT, response_text TEXT, audio_input_path TEXT, audio_output_path TEXT, stt_engine TEXT, tts_engine TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS voice_transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, transcript TEXT NOT NULL, source TEXT NOT NULL, audio_path TEXT, confidence REAL, metadata TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (session_id) REFERENCES voice_sessions(id) ON DELETE SET NULL);
      CREATE TABLE IF NOT EXISTS voice_outputs (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, text TEXT NOT NULL, engine TEXT NOT NULL, output_path TEXT, status TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (session_id) REFERENCES voice_sessions(id) ON DELETE SET NULL);
      CREATE TABLE IF NOT EXISTS system_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, message TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS idx_voice_sessions_created ON voice_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_voice_transcripts_session ON voice_transcripts(session_id);
      CREATE INDEX IF NOT EXISTS idx_voice_outputs_session ON voice_outputs(session_id);
    `);
  }

  createVoiceSession(input: { mode: string; status?: string; inputText?: string | null; audioInputPath?: string | null; sttEngine?: string | null; ttsEngine?: string | null }): VoiceSession {
    const result = this.#database.prepare("INSERT INTO voice_sessions (mode, status, input_text, audio_input_path, stt_engine, tts_engine) VALUES (?, ?, ?, ?, ?, ?)").run(input.mode, input.status ?? "created", input.inputText ?? null, input.audioInputPath ?? null, input.sttEngine ?? null, input.ttsEngine ?? null);
    this.logEvent("voice_session_created", `Voice session ${result.lastInsertRowid} created.`, { mode: input.mode });
    return this.getSession(Number(result.lastInsertRowid));
  }

  updateVoiceSession(id: number, patch: SessionPatch): VoiceSession {
    const fields: string[] = []; const values: unknown[] = [];
    const mapping: Array<[keyof SessionPatch, string]> = [["status", "status"], ["inputText", "input_text"], ["transcript", "transcript"], ["responseText", "response_text"], ["audioInputPath", "audio_input_path"], ["audioOutputPath", "audio_output_path"], ["sttEngine", "stt_engine"], ["ttsEngine", "tts_engine"]];
    for (const [key, column] of mapping) if (key in patch) { fields.push(`${column} = ?`); values.push(patch[key] ?? null); }
    if (fields.length) this.#database.prepare(`UPDATE voice_sessions SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
    return this.getSession(id);
  }

  getSession(id: number): VoiceSession {
    const row = this.#database.prepare("SELECT * FROM voice_sessions WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Voice session not found.");
    return sessionFromRow(row);
  }

  listVoiceSessions(limit = 25): VoiceSession[] {
    return (this.#database.prepare("SELECT * FROM voice_sessions ORDER BY created_at DESC, id DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 100)) as Row[]).map(sessionFromRow);
  }

  saveTranscript(input: { sessionId?: number | null; transcript: string; source: string; audioPath?: string | null; confidence?: number | null; metadata?: unknown }): number {
    const result = this.#database.prepare("INSERT INTO voice_transcripts (session_id, transcript, source, audio_path, confidence, metadata) VALUES (?, ?, ?, ?, ?, ?)").run(input.sessionId ?? null, input.transcript.trim(), input.source, input.audioPath ?? null, input.confidence ?? null, JSON.stringify(input.metadata ?? {}));
    this.logEvent("voice_transcript_saved", "A local voice transcript was saved.", { sessionId: input.sessionId ?? null, source: input.source });
    return Number(result.lastInsertRowid);
  }

  saveVoiceOutput(input: { sessionId?: number | null; text: string; engine: string; outputPath?: string | null; status: string; metadata?: unknown }): number {
    const result = this.#database.prepare("INSERT INTO voice_outputs (session_id, text, engine, output_path, status, metadata) VALUES (?, ?, ?, ?, ?, ?)").run(input.sessionId ?? null, input.text, input.engine, input.outputPath ?? null, input.status, JSON.stringify(input.metadata ?? {}));
    this.logEvent("voice_output_saved", "A local voice output attempt was recorded.", { sessionId: input.sessionId ?? null, engine: input.engine, status: input.status });
    return Number(result.lastInsertRowid);
  }

  logEvent(eventType: string, message: string, metadata: unknown = {}): void {
    this.#database.prepare("INSERT INTO system_events (event_type, message, metadata) VALUES (?, ?, ?)").run(eventType, message, JSON.stringify(metadata));
  }

  resolveOutput(filename: string): string | null {
    if (!filename || filename !== basename(filename)) return null;
    const candidate = resolve(this.config.outputDir, filename);
    const root = resolve(this.config.outputDir);
    return candidate.startsWith(`${root}${sep}`) && existsSync(candidate) ? candidate : null;
  }
}

let defaultService: VoiceService | undefined;
export const getVoiceService = (): VoiceService => defaultService ??= new VoiceService();
export const createVoiceSession = (input: Parameters<VoiceService["createVoiceSession"]>[0]) => getVoiceService().createVoiceSession(input);
export const saveTranscript = (input: Parameters<VoiceService["saveTranscript"]>[0]) => getVoiceService().saveTranscript(input);
export const saveVoiceOutput = (input: Parameters<VoiceService["saveVoiceOutput"]>[0]) => getVoiceService().saveVoiceOutput(input);
export const listVoiceSessions = (limit?: number) => getVoiceService().listVoiceSessions(limit);

export async function transcribeWithLocalEngine(audioPath: string, engine?: string): Promise<TranscriptionResult> {
  const selected = engine?.trim().toLowerCase() || getVoiceConfig().sttEngine;
  if (!getVoiceConfig().enabled) return { status: "setup-needed", configured: false, engine: selected, transcript: null, message: "Voice is disabled." };
  if (selected !== "whispercpp") return { status: "setup-needed", configured: false, engine: selected, transcript: null, message: `Unsupported local STT engine: ${selected}.` };
  return transcribeWithWhisperCpp(audioPath);
}

export async function synthesizeSpeech(text: string, options: { engine?: string; sessionId?: number } = {}): Promise<SpeechResult> {
  const clean = text.trim();
  if (!clean) throw new Error("text is required.");
  if (clean.length > 10_000) throw new Error("Speech text is limited to 10,000 characters.");
  const config = getVoiceConfig(); const engine = options.engine?.trim().toLowerCase() || config.ttsEngine;
  if (!config.enabled) return { status: "setup-needed", configured: false, engine, outputPath: null, absoluteOutputPath: null, message: "Voice is disabled." };
  ensureVoiceFolders();
  const absoluteOutputPath = join(config.outputDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.wav`);
  let result = engine === "windows" ? await synthesizeWithWindowsTTS(clean, absoluteOutputPath) : engine === "piper" ? await synthesizeWithPiper(clean, absoluteOutputPath) : { status: "setup-needed", configured: false, engine, outputPath: null, absoluteOutputPath: null, message: `Unsupported local TTS engine: ${engine}.` } as SpeechResult;
  if (result.absoluteOutputPath) result = { ...result, outputPath: relative(config.rootDir, result.absoluteOutputPath).replace(/\\/g, "/") };
  getVoiceService().saveVoiceOutput({ sessionId: options.sessionId, text: clean, engine, outputPath: result.outputPath, status: result.status, metadata: { message: result.message } });
  if (options.sessionId) getVoiceService().updateVoiceSession(options.sessionId, { ttsEngine: engine, audioOutputPath: result.outputPath, status: result.status });
  return result;
}

export { getVoiceConfig, getVoiceStatus };
