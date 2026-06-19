import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ToolDefinition, ToolRiskLevel } from "./tool.types";
import { ToolRunnerError } from "./tool.types";

type Row = Record<string, unknown>;

export const DEFAULT_TOOLS: Array<Omit<ToolDefinition, "id" | "createdAt" | "updatedAt">> = [
  { toolKey: "system.status.snapshot", name: "System status snapshot", description: "Returns FREEOS API, Ollama, memory, research, voice, and SearXNG status.", category: "system", riskLevel: "read_only", enabled: true, requiresApproval: false },
  { toolKey: "projects.list", name: "List projects", description: "Lists registered FREEOS projects.", category: "projects", riskLevel: "read_only", enabled: true, requiresApproval: false },
  { toolKey: "memory.status", name: "Memory status", description: "Shows approved, pending, and rejected memory counts.", category: "memory", riskLevel: "read_only", enabled: true, requiresApproval: false },
  { toolKey: "research.status", name: "Research status", description: "Shows local SearXNG and research status.", category: "research", riskLevel: "read_only", enabled: true, requiresApproval: false },
  { toolKey: "voice.status", name: "Voice status", description: "Shows local voice, STT, and TTS status.", category: "voice", riskLevel: "read_only", enabled: true, requiresApproval: false },
  { toolKey: "notes.create_project_note", name: "Create project note", description: "Creates a project note inside FREEOS project knowledge.", category: "knowledge", riskLevel: "low_risk_write", enabled: true, requiresApproval: true },
  { toolKey: "memory.create_proposal", name: "Create memory proposal", description: "Creates a pending memory proposal; it never creates approved memory.", category: "memory", riskLevel: "low_risk_write", enabled: true, requiresApproval: true },
  { toolKey: "files.create_freeos_text_file", name: "Create FREEOS text file", description: "Creates a text or Markdown file only inside allowed FREEOS folders.", category: "files", riskLevel: "low_risk_write", enabled: true, requiresApproval: true },
  { toolKey: "scripts.run_freeos_script", name: "Run approved FREEOS script", description: "Previews and runs an explicitly whitelisted script from tools/scripts after approval.", category: "scripts", riskLevel: "medium_risk", enabled: true, requiresApproval: true },
  ...["files.delete", "email.send", "trade.place_order", "deploy.production", "purchase.make", "credentials.read"].map((toolKey) => ({
    toolKey, name: toolKey.split(".").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "), description: "Blocked high-risk example. Execution is not implemented in Phase 5.", category: toolKey.split(".")[0]!, riskLevel: "high_risk" as ToolRiskLevel, enabled: false, requiresApproval: true,
  })),
];

function findRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    try { if ((JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: string }).name === "freeos") return current; } catch { /* keep walking */ }
    const parent = dirname(current); if (parent === current) return resolve(start); current = parent;
  }
}

export function toolFromRow(row: Row): ToolDefinition {
  return { id: Number(row.id), toolKey: String(row.tool_key), name: String(row.name), description: String(row.description), category: String(row.category), riskLevel: String(row.risk_level) as ToolRiskLevel, enabled: Boolean(row.enabled), requiresApproval: Boolean(row.requires_approval), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export class ToolRegistry {
  readonly rootDir: string;
  readonly databasePath: string;
  readonly database: Database.Database;

  constructor(options: { rootDir?: string; databasePath?: string } = {}) {
    this.rootDir = resolve(options.rootDir ?? process.env.FREEOS_ROOT ?? findRoot());
    this.databasePath = resolve(options.databasePath ?? join(this.rootDir, "data", "freeos.sqlite"));
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.database = new Database(this.databasePath);
    this.database.pragma("foreign_keys = ON"); this.database.pragma("journal_mode = WAL");
    this.initialize();
  }

  initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tool_registry (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, risk_level TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, requires_approval INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS tool_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_key TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', requested_args TEXT NOT NULL DEFAULT '{}', risk_level TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT NOT NULL DEFAULT 'dashboard', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT, result_id INTEGER, FOREIGN KEY (tool_key) REFERENCES tool_registry(tool_key), FOREIGN KEY (result_id) REFERENCES tool_runs(id));
      CREATE TABLE IF NOT EXISTS tool_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_key TEXT NOT NULL, request_id INTEGER, status TEXT NOT NULL, args TEXT NOT NULL DEFAULT '{}', output TEXT, error TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, FOREIGN KEY (tool_key) REFERENCES tool_registry(tool_key), FOREIGN KEY (request_id) REFERENCES tool_requests(id));
      CREATE TABLE IF NOT EXISTS automation_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, trigger_type TEXT NOT NULL, trigger_config TEXT NOT NULL DEFAULT '{}', action_tool_key TEXT NOT NULL, action_args TEXT NOT NULL DEFAULT '{}', requires_approval INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (action_tool_key) REFERENCES tool_registry(tool_key));
      CREATE TABLE IF NOT EXISTS automation_events (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (rule_key) REFERENCES automation_rules(rule_key));
      CREATE TABLE IF NOT EXISTS system_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, message TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS idx_tool_requests_status ON tool_requests(status); CREATE INDEX IF NOT EXISTS idx_tool_runs_started ON tool_runs(started_at); CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled); CREATE INDEX IF NOT EXISTS idx_automation_events_created ON automation_events(created_at);
    `);
  }

  registerDefaultTools(): ToolDefinition[] {
    const statement = this.database.prepare(`INSERT INTO tool_registry (tool_key,name,description,category,risk_level,enabled,requires_approval) VALUES (@toolKey,@name,@description,@category,@riskLevel,@enabled,@requiresApproval) ON CONFLICT(tool_key) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,risk_level=excluded.risk_level,enabled=excluded.enabled,requires_approval=excluded.requires_approval,updated_at=CURRENT_TIMESTAMP`);
    this.database.transaction(() => { for (const tool of DEFAULT_TOOLS) statement.run({ ...tool, enabled: Number(tool.enabled), requiresApproval: Number(tool.requiresApproval) }); })();
    this.logEvent("tools.registered", "Default Phase 5 tools registered.", { count: DEFAULT_TOOLS.length });
    return this.listTools();
  }

  listTools(): ToolDefinition[] { return (this.database.prepare("SELECT * FROM tool_registry ORDER BY risk_level, category, name").all() as Row[]).map(toolFromRow); }
  getToolByKey(toolKey: string): ToolDefinition | null { const row = this.database.prepare("SELECT * FROM tool_registry WHERE tool_key = ?").get(toolKey) as Row | undefined; return row ? toolFromRow(row) : null; }
  requireTool(toolKey: string): ToolDefinition { const tool = this.getToolByKey(toolKey); if (!tool) throw new ToolRunnerError(`Unknown tool: ${toolKey}.`, "not_found"); return tool; }
  logEvent(eventType: string, message: string, metadata: unknown = {}): void { this.database.prepare("INSERT INTO system_events (event_type,message,metadata) VALUES (?,?,?)").run(eventType, message, JSON.stringify(metadata)); }
  close(): void { this.database.close(); }
}

let singleton: ToolRegistry | null = null;
export function getToolRegistry(): ToolRegistry { if (!singleton) { singleton = new ToolRegistry(); singleton.registerDefaultTools(); } return singleton; }
export function registerDefaultTools(): ToolDefinition[] { return getToolRegistry().registerDefaultTools(); }
export function listTools(): ToolDefinition[] { return getToolRegistry().listTools(); }
export function getToolByKey(toolKey: string): ToolDefinition | null { return getToolRegistry().getToolByKey(toolKey); }
