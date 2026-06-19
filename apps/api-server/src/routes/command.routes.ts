import { Router } from "express";
import { checkSearxngStatus, getResearchService } from "@freeos/research-core";
import { getMemoryStore } from "@freeos/memory-core";
import { getVoiceStatus, synthesizeSpeech } from "@freeos/voice-core";
import { getToolRegistry, ToolRequests } from "@freeos/tool-runner";
import { getRagConfig, RagService } from "@freeos/rag-core";
import Database from "better-sqlite3";
import { join } from "node:path";
import { config } from "../config";
import { getOllamaStatus } from "../services/ollama.service";
import { getSystemStatus } from "../services/system.service";
import { createBackup, getBackupStatus } from "../services/backup.service";

export const commandRouter = Router();
getMemoryStore(); // Initializes additive Command Center tables before any command endpoint is called.
const store = () => getMemoryStore();
const registry = () => getToolRegistry();
const db = () => registry().database;

// Get or create RAG service
let ragService: RagService | null = null;
function getRagService(): RagService | null {
  if (!ragService) {
    try {
      const ragConfig = getRagConfig();
      if (!ragConfig.enabled) return null;
      
      const freeosRoot = process.env.FREEOS_ROOT || process.cwd();
      const dbPath = join(freeosRoot, "data", "freeos.sqlite");
      const ragDb = new Database(dbPath);
      ragDb.pragma("foreign_keys = ON");
      ragService = new RagService(ragConfig, ragDb);
    } catch {
      return null;
    }
  }
  return ragService;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (sql: string, ...args: unknown[]) => Number((db().prepare(sql).get(...args) as { count: number }).count);
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const tags = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];


commandRouter.get("/status", async (_request, response, next) => {
  try {
    const [ollama, searxngOnline] = await Promise.all([getOllamaStatus(), checkSearxngStatus(config.searxngBaseUrl)]);
    const memory = store().getMemoryStatus(); const projects = store().getProjectStatus(); const voice = getVoiceStatus(); const tools = registry().listTools();
    const pendingMemory = memory.pendingProposals; const pendingTools = count("SELECT COUNT(*) AS count FROM tool_requests WHERE status='pending'");
    response.json({
      version: config.version, releaseName: config.releaseName, phaseNumber: config.phaseNumber, isStableRelease: true,
      api: { online: true, service: "FREEOS API", timestamp: new Date().toISOString() }, system: getSystemStatus(), ollama: { ...ollama, defaultModel: config.defaultModel }, memory,
      projects, research: { searxngOnline, searxngBaseUrl: config.searxngBaseUrl, counts: getResearchService().getStatusCounts() }, voice,
      tools: { enabled: true, registered: tools.length, pendingRequests: pendingTools, highRiskBlocked: tools.filter((tool) => tool.riskLevel === "high_risk").every((tool) => !tool.enabled) },
      automations: { enabled: true, mode: "manual-preview", rules: count("SELECT COUNT(*) AS count FROM automation_rules"), enabledRules: count("SELECT COUNT(*) AS count FROM automation_rules WHERE enabled=1") },
      approvals: { pendingMemory, pendingTools, pendingAutomations: count("SELECT COUNT(*) AS count FROM tool_requests WHERE status='pending' AND requested_by LIKE 'automation:%'"), total: pendingMemory + pendingTools },
      activity: { recentCount: getActivity(25).length, lastEventAt: getActivity(1)[0]?.timestamp ?? null }, backup: getBackupStatus(),
      costs: { paidApiKeysRequired: false, cloudProvidersEnabled: false }, safety: { dangerousActionsEnabled: false, approvalRequiredForWrites: true, highRiskToolsBlocked: true, alwaysListening: false, chatExecutesTools: false },
    });
  } catch (error) { next(error); }
});

interface ActivityItem { id: number; type: string; title: string; message: string; status: string; timestamp: string }
function getActivity(limit: number): ActivityItem[] {
  const specs = [
    ["system", "SELECT id, event_type AS title, message, 'recorded' AS status, created_at AS timestamp FROM system_events ORDER BY id DESC LIMIT ?"],
    ["tool_run", "SELECT id, tool_key AS title, COALESCE(error, output, 'Tool run') AS message, status, started_at AS timestamp FROM tool_runs ORDER BY id DESC LIMIT ?"],
    ["tool_request", "SELECT id, title, description AS message, status, created_at AS timestamp FROM tool_requests ORDER BY id DESC LIMIT ?"],
    ["automation", "SELECT id, rule_key AS title, message, status, created_at AS timestamp FROM automation_events ORDER BY id DESC LIMIT ?"],
    ["research", "SELECT id, title, query AS message, status, created_at AS timestamp FROM research_sessions ORDER BY id DESC LIMIT ?"],
    ["memory", "SELECT id, title, content AS message, status, created_at AS timestamp FROM memory_proposals ORDER BY id DESC LIMIT ?"],
    ["voice", "SELECT id, mode AS title, COALESCE(transcript, input_text, 'Voice session') AS message, status, created_at AS timestamp FROM voice_sessions ORDER BY id DESC LIMIT ?"],
    ["chat", "SELECT id, 'Local chat' AS title, message, 'completed' AS status, created_at AS timestamp FROM command_chat_sessions ORDER BY id DESC LIMIT ?"],
    ["backup", "SELECT id, 'Backup created' AS title, backup_path AS message, status, created_at AS timestamp FROM backup_events ORDER BY id DESC LIMIT ?"],
  ] as const;
  return specs.flatMap(([type, sql]) => (db().prepare(sql).all(limit) as Array<Record<string, unknown>>).map((row): ActivityItem => ({ id: Number(row.id), type, title: String(row.title ?? type), message: String(row.message ?? ""), status: String(row.status ?? "recorded"), timestamp: String(row.timestamp) }))).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}

commandRouter.get("/activity", (request, response, next) => { try { const limit = Math.min(Math.max(Number(request.query.limit) || 25, 1), 100); response.json({ activity: getActivity(limit), limit }); } catch (error) { next(error); } });
commandRouter.get("/approvals", (_request, response, next) => { try { const memoryProposals = store().listProposals("pending"); const service = new ToolRequests(registry()); const toolRequests = [...service.listToolRequests("pending"), ...service.listToolRequests("approved")].sort((a, b) => b.id - a.id); response.json({ memoryProposals, toolRequests, automationToolRequests: toolRequests.filter((item) => item.requestedBy.startsWith("automation:")), total: memoryProposals.length + toolRequests.length }); } catch (error) { next(error); } });

commandRouter.post("/quick-note", (request, response, next) => {
  try {
    const body = record(request.body); const title = String(body.title ?? "").trim(); const content = String(body.content ?? "").trim();
    if (!title || !content) { response.status(400).json({ error: "title and content are required." }); return; }
    const projectKey = typeof body.projectKey === "string" && body.projectKey.trim() ? body.projectKey.trim() : undefined;
    if (projectKey) { const note = store().createProjectNote({ projectKey, title, content, tags: tags(body.tags), source: "command-center" }); response.status(201).json({ kind: "project-note", note, approvedMemoryCreated: false }); return; }
    const proposal = store().createProposal({ title, content, category: "general", tags: tags(body.tags), source: "command-center", reason: "Quick note awaiting human review." });
    response.status(201).json({ kind: "memory-proposal", proposal, approvedMemoryCreated: false });
  } catch (error) { next(error); }
});

commandRouter.post("/backup", async (request, response, next) => { try { const body = record(request.body); response.status(201).json({ backup: await createBackup({ includeDatabase: bool(body.includeDatabase, true), includeProjects: bool(body.includeProjects, true), includeDocs: bool(body.includeDocs, true), includeLogs: bool(body.includeLogs, false) }) }); } catch (error) { next(error); } });
commandRouter.get("/backup/status", (_request, response, next) => { try { response.json(getBackupStatus()); } catch (error) { next(error); } });

const systemPrompt = `You are free-os, the local-first FREEOS assistant. You help Drew Free build, research, plan, code, organize, and operate local systems. You must respect FREEOS safety rules. You cannot execute destructive or risky actions. You cannot send messages, trade, purchase, deploy, delete files, or access credentials. You can suggest tools or create approval requests when appropriate. You use approved local memory only. You do not invent saved memory or system telemetry. For status questions, use only the supplied LIVE FREEOS STATUS and clearly say when a metric is not available. You do not require paid API keys. Keep answers direct, practical, and execution-focused.`;
const highRisk = /\b(delete|remove files?|send (?:an? )?(?:email|message)|purchase|buy|trade|deploy|credential|password|secret|format (?:the )?drive|shutdown|reboot)\b/i;
const remember = /\bremember\s+(?:that\s+)?(.+)/is;

commandRouter.post("/chat", async (request, response, next) => {
  const body = record(request.body); const message = String(body.message ?? "").trim();
  if (!message) { response.status(400).json({ error: "message is required." }); return; }
  try {
    const projectKey = typeof body.projectKey === "string" && body.projectKey.trim() ? body.projectKey.trim() : undefined;
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : config.defaultModel;
    const useMemory = bool(body.useMemory, true); const useProjectNotes = bool(body.useProjectNotes, true); const useResearchContext = bool(body.useResearchContext, false);
    let createdMemoryProposalId: number | null = null; let createdToolRequestId: number | null = null; let responseText: string;
    let ragUsed = false;
    let ragSources: Array<{ documentPath: string; documentName: string; chunks: number[] }> = [];
    let ragContext = "";
    const warnings: string[] = [];
    if (highRisk.test(message)) {
      responseText = "I can’t perform or queue that high-risk action. FREEOS keeps destructive actions, sending, purchases, trading, deployments, and credential access blocked. I can help with a safe plan or read-only review instead.";
    } else {
      const memoryMatch = message.match(remember);
      if (memoryMatch?.[1]) createdMemoryProposalId = store().createProposal({ title: memoryMatch[1].trim().slice(0, 80), content: memoryMatch[1].trim(), category: projectKey ? "project" : "general", projectKey, source: "command-chat", reason: "Requested in local chat; awaiting approval." }).id;
      if (bool(body.allowToolSuggestions, true) && /\b(run|execute|create|write)\b/i.test(message)) {
        const match = registry().listTools().find((tool) => tool.enabled && tool.requiresApproval && (message.toLowerCase().includes(tool.toolKey.toLowerCase()) || message.toLowerCase().includes(tool.name.toLowerCase())));
        if (match) createdToolRequestId = new ToolRequests(registry()).createToolRequest({ toolKey: match.toolKey, title: `Chat request: ${match.name}`, description: message, args: {}, requestedBy: "command-chat" }).id;
      }
      const context = store().buildLocalContext({ projectKey, includeProjectNotes: Boolean(projectKey && useProjectNotes), memoryQuery: useMemory ? message : undefined, limit: 8 });
      const memoryStatus = store().getMemoryStatus(); const projectStatus = store().getProjectStatus(); const tools = registry().listTools();
      const liveStatus = `LIVE FREEOS STATUS\n- Phase: ${getSystemStatus().phase}\n- API: online\n- Ollama model: ${model}\n- Approved memories: ${memoryStatus.approvedMemories}\n- Pending memory proposals: ${memoryStatus.pendingProposals}\n- Projects: ${projectStatus.projectCount}\n- Project notes: ${projectStatus.notesCount}\n- Registered tools: ${tools.length}\n- Pending tool requests: ${count("SELECT COUNT(*) AS count FROM tool_requests WHERE status='pending'")}\n- Dangerous actions: off\n- High-risk tools: blocked\n- Paid API keys required: no\n- Cloud providers: off\n- Always-listening microphone: off\n- CPU, RAM, disk, security scans, network state, and user sessions: not measured by this endpoint`;
      let research = "";
      if (useResearchContext) {
        const rows = db().prepare("SELECT title, query FROM research_sessions ORDER BY id DESC LIMIT 5").all() as Array<{ title: string; query: string }>;
        research = `RECENT RESEARCH SESSIONS\n${rows.map((row) => `- ${row.title}: ${row.query}`).join("\n")}`;
      }
      
      const useRag = bool(body.useRag, false);
      const ragMode = typeof body.ragMode === "string" ? body.ragMode : "keyword";
      const ragTopK = typeof body.ragTopK === "number" ? body.ragTopK : undefined;
      
      if (useRag) {
        const rag = getRagService();
        if (rag) {
          try {
            const contextResult = await rag.buildContext(message, projectKey, ragTopK, false, false, true);
            if (contextResult.context && contextResult.context.trim().length > 0) {
              ragUsed = true;
              ragSources = contextResult.sources;
              ragContext = `INDEXED DOCUMENTS\n${contextResult.context}`;
            } else {
              warnings.push("RAG requested but no matching indexed documents were found.");
            }
          } catch (error) {
            console.warn("RAG context retrieval failed, continuing without RAG:", error);
            warnings.push("RAG context retrieval failed. Chat will continue without indexed documents.");
          }
        } else if (bool(body.useRag, false)) {
          warnings.push("RAG is not enabled or unavailable. Chat will continue without indexed documents.");
        }
      }
      
      const localResponse = await fetch(`${config.ollamaBaseUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ model, prompt: message, system: [systemPrompt, liveStatus, context, research, ragContext, createdMemoryProposalId ? "A pending memory proposal was created; tell the user it still requires approval." : "", createdToolRequestId ? "A tool request was created; tell the user it requires approval and a separate Run click." : ""].filter(Boolean).join("\n\n"), stream: false, think: false, options: { temperature: 0.2, num_predict: 500 } }), signal: AbortSignal.timeout(120_000) });
      if (!localResponse.ok) throw new Error(`Local Ollama returned HTTP ${localResponse.status}.`);
      const payload = await localResponse.json() as { response?: string }; responseText = payload.response?.trim() ?? "";
      if (!responseText) throw new Error("Local Ollama returned an empty response.");
    }
    const speech = body.speak === true ? await synthesizeSpeech(responseText) : null;
    const result = db().prepare(`INSERT INTO command_chat_sessions (message,response,project_key,model,used_memory,used_project_notes,used_research_context,created_memory_proposal_id,created_tool_request_id,audio_output_path) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(message, responseText, projectKey ?? null, model, useMemory ? 1 : 0, projectKey && useProjectNotes ? 1 : 0, useResearchContext ? 1 : 0, createdMemoryProposalId, createdToolRequestId, speech?.outputPath ?? null);
    response.json({ id: Number(result.lastInsertRowid), response: responseText, model, localOnly: true, cloudProviderUsed: false, toolsExecuted: false, memoryApproved: false, createdMemoryProposalId, createdToolRequestId, audioOutputPath: speech?.outputPath ?? null, audioUrl: speech?.outputPath ? `/voice/outputs/${encodeURIComponent(speech.outputPath.split("/").pop()!)}` : null, memoryUsed: useMemory, projectNotesUsed: Boolean(projectKey && useProjectNotes), ragUsed, ragSources: ragSources ?? [], ragMode: ragUsed ? (typeof body.ragMode === "string" ? body.ragMode : "keyword") : undefined, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (error) { next(error); }
});
