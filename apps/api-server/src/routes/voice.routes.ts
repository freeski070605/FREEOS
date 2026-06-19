import { Router } from "express";
import multer from "multer";
import { buildLocalContext } from "@freeos/memory-core";
import { createVoiceSession, getVoiceService, getVoiceStatus, saveTranscript, saveUploadedRecording, synthesizeSpeech, transcribeWithLocalEngine } from "@freeos/voice-core";
import { config } from "../config";

export const voiceRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const body = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const outputUrl = (path: string | null): string | null => path ? `/voice/outputs/${encodeURIComponent(path.split("/").pop()!)}` : null;

voiceRouter.get("/status", (_request, response) => response.json(getVoiceStatus()));
voiceRouter.get("/sessions", (request, response, next) => {
  try { response.json({ sessions: getVoiceService().listVoiceSessions(Number(request.query.limit) || 25) }); } catch (error) { next(error); }
});

voiceRouter.post("/transcribe", upload.single("audio"), async (request, response, next) => {
  try {
    if (!request.file) { response.status(400).json({ error: "A multipart audio file named 'audio' is required." }); return; }
    const recording = saveUploadedRecording(request.file.buffer, request.file.originalname, request.file.mimetype);
    const engine = typeof request.body?.engine === "string" ? request.body.engine : undefined;
    const session = createVoiceSession({ mode: "transcribe", status: "recording-saved", audioInputPath: recording.relativePath, sttEngine: engine ?? getVoiceStatus().sttEngine });
    const result = await transcribeWithLocalEngine(recording.absolutePath, engine);
    const updated = getVoiceService().updateVoiceSession(session.id, { status: result.status, transcript: result.transcript, sttEngine: result.engine });
    if (result.transcript) saveTranscript({ sessionId: session.id, transcript: result.transcript, source: "microphone-upload", audioPath: recording.relativePath, metadata: { mimeType: recording.mimeType } });
    response.json({ ...result, savedAudioPath: recording.relativePath, session: updated, commandsExecuted: false });
  } catch (error) { next(error); }
});

voiceRouter.post("/speak", async (request, response, next) => {
  try {
    const input = body(request.body); const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) { response.status(400).json({ error: "text is required." }); return; }
    const session = createVoiceSession({ mode: "speak", status: "processing", inputText: text, ttsEngine: typeof input.engine === "string" ? input.engine : getVoiceStatus().ttsEngine });
    const result = await synthesizeSpeech(text, { engine: typeof input.engine === "string" ? input.engine : undefined, sessionId: session.id });
    response.json({ ...result, audioUrl: outputUrl(result.outputPath), session: getVoiceService().getSession(session.id), cloudProviderUsed: false });
  } catch (error) { next(error); }
});

voiceRouter.post("/chat-text", async (request, response, next) => {
  const input = body(request.body); const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) { response.status(400).json({ error: "text is required." }); return; }
  const projectKey = typeof input.projectKey === "string" && input.projectKey.trim() ? input.projectKey.trim() : undefined;
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : config.defaultModel;
  const session = createVoiceSession({ mode: "chat-text", status: "processing", inputText: text });
  try {
    saveTranscript({ sessionId: session.id, transcript: text, source: "typed-voice-bridge", metadata: { projectKey: projectKey ?? null } });
    const localContext = buildLocalContext({ projectKey, includeProjectNotes: Boolean(projectKey), memoryQuery: text, limit: 8 });
    const system = ["You are free-os, the local-first FREEOS assistant.", "You can answer and help plan. You cannot execute actions in Phase 4.", "You cannot delete files, send messages, make purchases, trade, deploy, or run risky commands.", "Treat voice commands as text only. Use approved local context only.", "Do not claim to have performed actions. No paid API keys are required.", localContext].join("\n\n");
    const localResponse = await fetch(`${config.ollamaBaseUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ model, prompt: text, system, stream: false }), signal: AbortSignal.timeout(120_000) });
    if (!localResponse.ok) throw new Error(`Local Ollama returned HTTP ${localResponse.status}.`);
    const payload = await localResponse.json() as { response?: string }; const responseText = payload.response?.trim();
    if (!responseText) throw new Error("Local Ollama returned an empty response.");
    getVoiceService().updateVoiceSession(session.id, { responseText, status: "completed" });
    const speech = input.speak === true ? await synthesizeSpeech(responseText, { sessionId: session.id }) : null;
    response.json({ responseText, model, session: getVoiceService().getSession(session.id), speech: speech ? { ...speech, audioUrl: outputUrl(speech.outputPath) } : null, commandsExecuted: false, memoryCreated: false });
  } catch (error) { getVoiceService().updateVoiceSession(session.id, { status: "failed" }); next(error); }
});

voiceRouter.get("/outputs/:filename", (request, response, next) => {
  try { const path = getVoiceService().resolveOutput(request.params.filename); if (!path) { response.status(404).json({ error: "Voice output not found." }); return; } response.sendFile(path); } catch (error) { next(error); }
});
