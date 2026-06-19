export interface HealthStatus { online: boolean; service: string; timestamp: string | null }
export interface SystemStatus {
  appName: "FREEOS";
  assistantName: "free-os";
  version: string;
  releaseName: string;
  isStableRelease: boolean;
  phase: string;
  localFirst: boolean;
  localMemoryEnabled: boolean;
  approvalBasedMemory: boolean;
  paidApiKeysRequired: boolean;
  dangerousActionsEnabled: boolean;
  toolRunnerEnabled: boolean;
  automationsEnabled: boolean;
  approvalRequiredForWrites: boolean;
  phaseNumber: number;
  commandCenterEnabled: boolean;
  highRiskToolsBlocked: boolean;
  alwaysListening: boolean;
  cloudProvidersEnabled: boolean;
}
export interface OllamaStatus { connected: boolean; models: string[]; message: string }
export interface MemoryStatus {
  databaseConnected: boolean;
  databasePath: string;
  approvedMemories: number;
  pendingProposals: number;
  rejectedProposals: number;
  projectNotes: number;
}
export interface Project {
  id: number;
  projectKey: string;
  name: string;
  description: string;
  folderPath: string;
  status: string;
}
export interface ProjectStatus {
  projectCount: number;
  notesCount: number;
  foldersVerified: boolean;
  folders: Array<{ projectKey: string; folderPath: string; exists: boolean }>;
}
export interface MemoryProposal {
  id: number;
  title: string;
  content: string;
  category: string;
  projectKey: string | null;
  source: string;
  tags: string[];
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}
export interface ApprovedMemory { id: number; title: string; content: string; category: string; projectKey: string | null; source: string; tags: string[]; createdAt: string; updatedAt: string }
export interface ProjectNote {
  id: number;
  projectKey: string;
  title: string;
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
}
export interface ResearchStatus {
  phase: string; searxngConfigured: boolean; searxngOnline: boolean; searxngBaseUrl: string;
  ollamaOnline: boolean; defaultModel: string; paidApiKeysRequired: boolean; dangerousActionsEnabled: boolean;
  counts: { sessions: number; results: number; sources: number };
}
export interface ResearchResult {
  id?: number; sessionId?: number | null; title: string; url: string; snippet: string; source: string; domain: string;
  contentPreview?: string | null; summary?: string | null; projectKey?: string | null;
  savedAsMemoryProposalId?: number | null; savedAsProjectNoteId?: number | null; createdAt?: string;
}
export interface ResearchSession { id: number; title: string; query: string; projectKey: string | null; status: string; createdAt: string; updatedAt: string; resultCount?: number }
export interface PageRead { title: string; url: string; domain: string; contentPreview: string; bytesRead: number; summary: string | null; summaryMessage: string | null }
export interface VoiceStatus {
  phase: string; voiceEnabled: boolean; sttEngine: string; sttConfigured: boolean; ttsEngine: string; ttsConfigured: boolean;
  recordingsDir: string; outputDir: string; paidApiKeysRequired: false; alwaysListening: false; dangerousActionsEnabled: false;
}
export interface VoiceSession {
  id: number; mode: string; status: string; inputText: string | null; transcript: string | null; responseText: string | null;
  audioInputPath: string | null; audioOutputPath: string | null; sttEngine: string | null; ttsEngine: string | null; createdAt: string; updatedAt: string;
}
export interface SpeechResponse { status: string; configured: boolean; engine: string; outputPath: string | null; audioUrl: string | null; message: string }
export interface TranscriptionResponse { status: string; configured: boolean; engine: string; transcript: string | null; message: string; savedAudioPath: string; session: VoiceSession }
export interface VoiceChatResponse { responseText: string; model: string; session: VoiceSession; speech: SpeechResponse | null; commandsExecuted: false; memoryCreated: false }
export type ToolRiskLevel = "read_only" | "low_risk_write" | "medium_risk" | "high_risk";
export interface ToolDefinition { id: number; toolKey: string; name: string; description: string; category: string; riskLevel: ToolRiskLevel; enabled: boolean; requiresApproval: boolean }
export interface ToolRequest { id: number; toolKey: string; title: string; description: string; args: Record<string, unknown>; riskLevel: ToolRiskLevel; status: "pending" | "approved" | "rejected" | "completed" | "blocked" | "failed"; requestedBy: string; createdAt: string; reviewedAt: string | null; resultId: number | null }
export interface ToolRun { id: number; toolKey: string; requestId: number | null; status: string; args: Record<string, unknown>; output: unknown; error: string | null; startedAt: string; finishedAt: string | null }
export interface ToolStatus { phase: string; toolsEnabled: boolean; dangerousActionsEnabled: false; approvalRequiredForWrites: true; registeredToolCount: number; pendingToolRequestCount: number; recentRunCount: number; paidApiKeysRequired: false }
export interface AutomationRule { id: number; ruleKey: string; name: string; description: string; enabled: boolean; triggerType: "manual" | "interval_preview"; triggerConfig: Record<string, unknown>; actionToolKey: string; actionArgs: Record<string, unknown>; requiresApproval: boolean; createdAt: string; updatedAt: string }
export interface AutomationStatus { automationsEnabled: boolean; rulesCount: number; enabledRulesCount: number; pendingApprovalCount: number; dangerousActionsEnabled: false }
export interface CommandActivity { id: number; type: string; title: string; message: string; status: string; timestamp: string }
export interface CommandApprovals { memoryProposals: MemoryProposal[]; toolRequests: ToolRequest[]; automationToolRequests: ToolRequest[]; total: number }
export interface BackupStatus { backupRoot: string; exists: boolean; count: number; recentBackups: Array<{ name: string; path: string; createdAt: string; manifestExists: boolean }>; neverDeletes: boolean; secretsExcluded: boolean }
export interface CommandChatResponse { id: number; response: string; model: string; localOnly: true; toolsExecuted: false; memoryApproved: false; createdMemoryProposalId: number | null; createdToolRequestId: number | null; audioOutputPath: string | null; audioUrl: string | null }
export interface CommandStatus { api: { online: boolean; service: string }; system: SystemStatus; ollama: OllamaStatus & { defaultModel: string }; memory: MemoryStatus; projects: ProjectStatus; research: { searxngOnline: boolean; searxngBaseUrl: string; counts: { sessions: number; results: number; sources: number } }; voice: VoiceStatus; tools: { enabled: boolean; registered: number; pendingRequests: number; highRiskBlocked: boolean }; automations: { enabled: boolean; mode: string; rules: number; enabledRules: number }; approvals: { pendingMemory: number; pendingTools: number; pendingAutomations: number; total: number }; activity: { recentCount: number; lastEventAt: string | null }; backup: BackupStatus; costs: { paidApiKeysRequired: false; cloudProvidersEnabled: false }; safety: { dangerousActionsEnabled: false; approvalRequiredForWrites: true; highRiskToolsBlocked: true; alwaysListening: false; chatExecutesTools: false } }

export interface ProposalInput {
  title: string;
  content: string;
  category: string;
  projectKey?: string;
  tags?: string[];
  reason?: string;
}

type JsonRecord = Record<string, unknown>;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestJson(path: string, init?: RequestInit, timeoutMs = 7000): Promise<unknown> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : `Request returned HTTP ${response.status}.`);
    }
    if (import.meta.env.DEV) console.debug(`[FREEOS API] ${path}`, payload);
    return payload;
  } catch (error) {
    if (import.meta.env.DEV) console.error(`[FREEOS API] ${path} failed:`, error);
    throw error instanceof Error ? error : new Error("The local API request failed.");
  }
}

function record(payload: unknown, path: string): JsonRecord {
  if (!isRecord(payload)) throw new Error(`Unexpected response from ${path}.`);
  return payload;
}

export const api = {
  commandStatus: async () => record(await requestJson("/command/status", undefined, 12000), "/command/status") as unknown as CommandStatus,
  commandActivity: async (limit = 25): Promise<CommandActivity[]> => { const data = record(await requestJson(`/command/activity?limit=${limit}`), "/command/activity"); return Array.isArray(data.activity) ? data.activity as CommandActivity[] : []; },
  commandApprovals: async () => record(await requestJson("/command/approvals"), "/command/approvals") as unknown as CommandApprovals,
  commandChat: async (input: { message: string; projectKey?: string; useMemory?: boolean; useProjectNotes?: boolean; useResearchContext?: boolean; allowToolSuggestions?: boolean; speak?: boolean; model?: string }) => record(await requestJson("/command/chat", { method: "POST", body: JSON.stringify(input) }, 130000), "/command/chat") as unknown as CommandChatResponse,
  quickNote: async (input: { projectKey?: string; title: string; content: string; tags?: string[] }) => requestJson("/command/quick-note", { method: "POST", body: JSON.stringify(input) }),
  createBackup: async (input: { includeDatabase: boolean; includeProjects: boolean; includeDocs: boolean; includeLogs: boolean }) => requestJson("/command/backup", { method: "POST", body: JSON.stringify(input) }, 120000),
  backupStatus: async () => record(await requestJson("/command/backup/status"), "/command/backup/status") as unknown as BackupStatus,
  health: async (): Promise<HealthStatus> => {
    const data = record(await requestJson("/health"), "/health");
    if (data.ok !== true) throw new Error("Unexpected response from /health.");
    return { online: true, service: typeof data.service === "string" ? data.service : "FREEOS API", timestamp: typeof data.timestamp === "string" ? data.timestamp : null };
  },
  system: async () => record(await requestJson("/system/status"), "/system/status") as unknown as SystemStatus,
  ollama: async () => record(await requestJson("/ollama/status"), "/ollama/status") as unknown as OllamaStatus,
  memoryStatus: async () => record(await requestJson("/memory/status"), "/memory/status") as unknown as MemoryStatus,
  projects: async (): Promise<Project[]> => {
    const data = record(await requestJson("/projects"), "/projects");
    return Array.isArray(data.projects) ? data.projects as Project[] : [];
  },
  projectStatus: async () => record(await requestJson("/projects/status"), "/projects/status") as unknown as ProjectStatus,
  proposals: async (status: "pending" | "approved" | "rejected" = "pending"): Promise<MemoryProposal[]> => {
    const data = record(await requestJson(`/memory/proposals?status=${status}`), "/memory/proposals");
    return Array.isArray(data.proposals) ? data.proposals as MemoryProposal[] : [];
  },
  memories: async (q = "", projectKey = ""): Promise<ApprovedMemory[]> => { const query = new URLSearchParams(); if (q) query.set("q", q); if (projectKey) query.set("projectKey", projectKey); const data = record(await requestJson(`/memory?${query}`), "/memory"); return Array.isArray(data.memories) ? data.memories as ApprovedMemory[] : []; },
  createProposal: async (input: ProposalInput) => requestJson("/memory/proposals", { method: "POST", body: JSON.stringify(input) }),
  approveProposal: async (id: number) => requestJson(`/memory/proposals/${id}/approve`, { method: "POST" }),
  rejectProposal: async (id: number) => requestJson(`/memory/proposals/${id}/reject`, { method: "POST" }),
  notes: async (projectKey: string): Promise<ProjectNote[]> => {
    const data = record(await requestJson(`/projects/${encodeURIComponent(projectKey)}/notes`), "/projects/:projectKey/notes");
    return Array.isArray(data.notes) ? data.notes as ProjectNote[] : [];
  },
  createNote: async (projectKey: string, input: { title: string; content: string; tags?: string[] }) =>
    requestJson(`/projects/${encodeURIComponent(projectKey)}/notes`, { method: "POST", body: JSON.stringify(input) }),
  researchStatus: async () => record(await requestJson("/research/status"), "/research/status") as unknown as ResearchStatus,
  researchSessions: async (): Promise<ResearchSession[]> => {
    const data = record(await requestJson("/research/sessions"), "/research/sessions");
    return Array.isArray(data.sessions) ? data.sessions as ResearchSession[] : [];
  },
  researchSession: async (id: number): Promise<{ session: ResearchSession; results: ResearchResult[] }> =>
    record(await requestJson(`/research/sessions/${id}`), "/research/sessions/:id") as unknown as { session: ResearchSession; results: ResearchResult[] },
  researchSearch: async (input: { query: string; projectKey?: string; maxResults: number }): Promise<{ session: ResearchSession | null; results: ResearchResult[] }> =>
    record(await requestJson("/research/search", { method: "POST", body: JSON.stringify(input) }, 20000), "/research/search") as unknown as { session: ResearchSession | null; results: ResearchResult[] },
  readPage: async (url: string, summarize = false): Promise<PageRead> => {
    const data = record(await requestJson("/research/read", { method: "POST", body: JSON.stringify({ url, summarize }) }, summarize ? 100000 : 20000), "/research/read");
    return data.page as PageRead;
  },
  summarizeResearchResult: async (id: number): Promise<ResearchResult> => {
    const data = record(await requestJson(`/research/results/${id}/summarize`, { method: "POST", body: "{}" }, 100000), "/research/results/:id/summarize");
    return data.result as ResearchResult;
  },
  createResearchProposal: async (id: number, input: { projectKey?: string }) => requestJson(`/research/results/${id}/create-memory-proposal`, { method: "POST", body: JSON.stringify(input) }),
  createResearchNote: async (id: number, input: { projectKey: string }) => requestJson(`/research/results/${id}/create-project-note`, { method: "POST", body: JSON.stringify(input) }),
  voiceStatus: async () => record(await requestJson("/voice/status"), "/voice/status") as unknown as VoiceStatus,
  voiceSessions: async (): Promise<VoiceSession[]> => {
    const data = record(await requestJson("/voice/sessions"), "/voice/sessions");
    return Array.isArray(data.sessions) ? data.sessions as VoiceSession[] : [];
  },
  transcribe: async (audio: Blob): Promise<TranscriptionResponse> => {
    const form = new FormData(); form.append("audio", audio, `freeos-recording-${Date.now()}.webm`);
    return record(await requestJson("/voice/transcribe", { method: "POST", body: form }, 120000), "/voice/transcribe") as unknown as TranscriptionResponse;
  },
  speak: async (text: string): Promise<SpeechResponse> => record(await requestJson("/voice/speak", { method: "POST", body: JSON.stringify({ text }) }, 120000), "/voice/speak") as unknown as SpeechResponse,
  voiceChat: async (input: { text: string; projectKey?: string; speak?: boolean }): Promise<VoiceChatResponse> => record(await requestJson("/voice/chat-text", { method: "POST", body: JSON.stringify(input) }, 130000), "/voice/chat-text") as unknown as VoiceChatResponse,
  toolsStatus: async () => record(await requestJson("/tools/status"), "/tools/status") as unknown as ToolStatus,
  tools: async (): Promise<ToolDefinition[]> => { const data = record(await requestJson("/tools"), "/tools"); return Array.isArray(data.tools) ? data.tools as ToolDefinition[] : []; },
  runReadonlyTool: async (toolKey: string, args: Record<string, unknown> = {}): Promise<ToolRun> => { const data = record(await requestJson("/tools/run-readonly", { method: "POST", body: JSON.stringify({ toolKey, args }) }, 20000), "/tools/run-readonly"); return data.run as ToolRun; },
  toolRequests: async (): Promise<ToolRequest[]> => { const data = record(await requestJson("/tools/requests"), "/tools/requests"); return Array.isArray(data.requests) ? data.requests as ToolRequest[] : []; },
  createToolRequest: async (input: { toolKey: string; title: string; description?: string; args?: Record<string, unknown> }): Promise<ToolRequest> => { const data = record(await requestJson("/tools/requests", { method: "POST", body: JSON.stringify(input) }), "/tools/requests"); return data.request as ToolRequest; },
  approveToolRequest: async (id: number): Promise<ToolRequest> => { const data = record(await requestJson(`/tools/requests/${id}/approve`, { method: "POST", body: "{}" }), "/tools/requests/:id/approve"); return data.request as ToolRequest; },
  rejectToolRequest: async (id: number): Promise<ToolRequest> => { const data = record(await requestJson(`/tools/requests/${id}/reject`, { method: "POST", body: "{}" }), "/tools/requests/:id/reject"); return data.request as ToolRequest; },
  runToolRequest: async (id: number): Promise<ToolRun> => { const data = record(await requestJson(`/tools/requests/${id}/run`, { method: "POST", body: "{}" }, 40000), "/tools/requests/:id/run"); return data.run as ToolRun; },
  toolRuns: async (): Promise<ToolRun[]> => { const data = record(await requestJson("/tools/runs"), "/tools/runs"); return Array.isArray(data.runs) ? data.runs as ToolRun[] : []; },
  automationsStatus: async () => record(await requestJson("/automations/status"), "/automations/status") as unknown as AutomationStatus,
  automations: async (): Promise<AutomationRule[]> => { const data = record(await requestJson("/automations"), "/automations"); return Array.isArray(data.rules) ? data.rules as AutomationRule[] : []; },
  createAutomation: async (input: { ruleKey: string; name: string; description?: string; triggerType: "manual" | "interval_preview"; actionToolKey: string; actionArgs: Record<string, unknown> }): Promise<AutomationRule> => { const data = record(await requestJson("/automations", { method: "POST", body: JSON.stringify(input) }), "/automations"); return data.rule as AutomationRule; },
  setAutomationEnabled: async (ruleKey: string, enabled: boolean): Promise<AutomationRule> => { const data = record(await requestJson(`/automations/${encodeURIComponent(ruleKey)}/${enabled ? "enable" : "disable"}`, { method: "POST", body: "{}" }), "/automations/:key/state"); return data.rule as AutomationRule; },
  checkAutomation: async (ruleKey: string) => requestJson(`/automations/${encodeURIComponent(ruleKey)}/check`, { method: "POST", body: "{}" }, 30000),
  audioUrl: (path: string | null | undefined) => path ? `${API_BASE_URL}${path}` : null,
};
