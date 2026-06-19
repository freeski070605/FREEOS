import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getMemoryStore } = require("../../packages/memory-core/dist/index.js");
const { ensureVoiceFolders, getVoiceService, getVoiceStatus } = require("../../packages/voice-core/dist/index.js");

const memory = getMemoryStore();
memory.initialize();
ensureVoiceFolders();
const voice = getVoiceService();
voice.initialize();
const status = getVoiceStatus();
console.log("[FREEOS] Voice folders and SQLite tables are ready.");
console.log(`[FREEOS] STT: ${status.sttEngine} (${status.sttConfigured ? "configured" : "setup needed"})`);
console.log(`[FREEOS] TTS: ${status.ttsEngine} (${status.ttsConfigured ? "configured" : "setup needed"})`);
memory.close();
