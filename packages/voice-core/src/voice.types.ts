export type VoiceState = "disabled" | "idle" | "processing" | "speaking";
export type VoiceEngineStatus = "completed" | "setup-needed" | "failed";

export interface VoiceConfiguration {
  rootDir: string;
  enabled: boolean;
  state: VoiceState;
  localOnly: true;
  recordingsDir: string;
  outputDir: string;
  transcriptsDir: string;
  sttEngine: string;
  ttsEngine: string;
  whisperCppPath: string | null;
  whisperModelPath: string | null;
  whisperModelFastPath: string | null;
  whisperModelBalancedPath: string | null;
  whisperModelQualityPath: string | null;
  ffmpegPath: string;
  piperPath: string | null;
  piperModelPath: string | null;
  piperVoiceName: string | null;
}

export interface VoiceStatus {
  phase: "Phase 4 — Voice Input/Output";
  voiceEnabled: boolean;
  sttEngine: string;
  sttConfigured: boolean;
  ttsEngine: string;
  ttsConfigured: boolean;
  recordingsDir: string;
  outputDir: string;
  paidApiKeysRequired: false;
  alwaysListening: false;
  dangerousActionsEnabled: false;
  message?: string;
}

export interface VoiceSession {
  id: number;
  mode: string;
  status: string;
  inputText: string | null;
  transcript: string | null;
  responseText: string | null;
  audioInputPath: string | null;
  audioOutputPath: string | null;
  sttEngine: string | null;
  ttsEngine: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAudio {
  absolutePath: string;
  relativePath: string;
  filename: string;
  mimeType: string;
}

export interface TranscriptionResult {
  status: VoiceEngineStatus;
  configured: boolean;
  engine: string;
  transcript: string | null;
  message: string;
}

export interface SpeechResult {
  status: VoiceEngineStatus;
  configured: boolean;
  engine: string;
  outputPath: string | null;
  absoluteOutputPath: string | null;
  message: string;
}
