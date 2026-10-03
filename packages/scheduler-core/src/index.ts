import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type ScheduleConfig =
  | { type: "once"; at: string }
  | { type: "interval"; everyMs: number; startsAt?: string }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; days: number[]; hour: number; minute: number };
export type Risk = "read_only" | "low_risk_write" | "medium_risk" | "high_risk";
export type ScheduleInput = { name: string; description?: string; scheduleConfig: ScheduleConfig; actionToolKey: string; actionArgs: Record<string, unknown>; projectKey?: string; enabled?: boolean; requiresApproval?: boolean };
export type Schedule = ScheduleInput & { id: string; enabled: boolean; requiresApproval: boolean; createdAt: string; updatedAt: string; lastRunAt: string | null; nextRunAt: string | null };
export type SchedulerRun = { id: string; scheduleId: string; occurrence: string; status: string; startedAt: string; completedAt: string | null; toolRequestId: number | null; result: unknown; error: string | null };
export type Adapter = {
  getTool(key: string): { enabled: boolean; riskLevel: Risk; requiresApproval: boolean } | null;
  runReadOnly(key: string, args: Record<string, unknown>): Promise<unknown>;
  request(key: string, args: Record<string, unknown>, title: string): { id: number };
};
export type SchedulerOptions = { enabled?: boolean; pollIntervalMs?: number; maxConcurrentRuns?: number; maxRunHistory?: number; startupCatchup?: boolean };
const iso = (time: number) => new Date(time).toISOString();
const nowIso = () => new Date().toISOString();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const parse = (value: unknown): any => JSON.parse(String(value));
function validDate(value: string): number { const time = Date.parse(value); if (!Number.isFinite(time) || !/\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error("An ISO timestamp is required."); return time; }
export function validateConfig(config: ScheduleConfig): void {
  if (!object(config)) throw new Error("Structured schedule configuration is required.");
  if (config.type === "once") validDate(config.at);
  else if (config.type === "interval") { if (!Number.isInteger(config.everyMs) || config.everyMs < 60_000 || config.everyMs > 365 * 86_400_000) throw new Error("Interval must be between one minute and one year."); if (config.startsAt) validDate(config.startsAt); }
  else if (config.type === "daily" || config.type === "weekly") {
    if (!Number.isInteger(config.hour) || config.hour < 0 || config.hour > 23 || !Number.isInteger(config.minute) || config.minute < 0 || config.minute > 59) throw new Error("Invalid local time.");
    if (config.type === "weekly" && (!Array.isArray(config.days) || !config.days.length || config.days.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw new Error("Weekly days must be 0 through 6.");
  } else throw new Error("Unsupported schedule type.");
}
export function nextRun(config: ScheduleConfig, after: Date): string | null {
  validateConfig(config);
  const timestamp = after.getTime();
  if (config.type === "once") { const at = validDate(config.at); return at > timestamp ? iso(at) : null; }
  if (config.type === "interval") { const anchor = config.startsAt ? validDate(config.startsAt) : timestamp; return iso(anchor > timestamp ? anchor : anchor + (Math.floor((timestamp - anchor) / config.everyMs) + 1) * config.everyMs); }
  const day = new Date(timestamp);
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, config.hour, config.minute);
    if (candidate.getTime() > timestamp && (config.type === "daily" || config.days.includes(candidate.getDay()))) return candidate.toISOString();
  }
  return null;
}
function rowSchedule(row: any): Schedule { return { id: row.id, name: row.name, description: row.description, enabled: Boolean(row.enabled), scheduleConfig: parse(row.schedule_config), actionToolKey: row.action_tool_key, actionArgs: parse(row.action_args), projectKey: row.project_key ?? undefined, requiresApproval: Boolean(row.requires_approval), createdAt: row.created_at, updatedAt: row.updated_at, lastRunAt: row.last_run_at, nextRunAt: row.next_run_at }; }
function rowRun(row: any): SchedulerRun { return { id: row.id, scheduleId: row.schedule_id, occurrence: row.occurrence, status: row.status, startedAt: row.started_at, completedAt: row.completed_at, toolRequestId: row.tool_request_id, result: row.result ? parse(row.result) : null, error: row.error }; }
export class Scheduler {
  readonly options: Required<SchedulerOptions>;
  private timer: NodeJS.Timeout | null = null;
  private active = 0;
  private ticking = false;
  constructor(readonly db: Database.Database, readonly adapter: Adapter, options: SchedulerOptions = {}) {
    this.options = { enabled: options.enabled ?? (process.env.SCHEDULER_ENABLED === "true"), pollIntervalMs: Math.max(1000, options.pollIntervalMs ?? (Number(process.env.SCHEDULER_POLL_INTERVAL_MS) || 60000)), maxConcurrentRuns: Math.max(1, options.maxConcurrentRuns ?? (Number(process.env.SCHEDULER_MAX_CONCURRENT_RUNS) || 1)), maxRunHistory: Math.max(1, options.maxRunHistory ?? (Number(process.env.SCHEDULER_MAX_RUN_HISTORY) || 500)), startupCatchup: options.startupCatchup ?? (process.env.SCHEDULER_STARTUP_CATCHUP === "true") };
    db.exec(`CREATE TABLE IF NOT EXISTS scheduler_schedules (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, schedule_config TEXT NOT NULL, action_tool_key TEXT NOT NULL, action_args TEXT NOT NULL, project_key TEXT, requires_approval INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_run_at TEXT, next_run_at TEXT);
      CREATE TABLE IF NOT EXISTS scheduler_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, occurrence TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, tool_request_id INTEGER, result TEXT, error TEXT, UNIQUE(schedule_id, occurrence));
      CREATE TABLE IF NOT EXISTS scheduler_runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_scheduler_due ON scheduler_schedules(enabled,next_run_at);
      CREATE INDEX IF NOT EXISTS idx_scheduler_runs_started ON scheduler_runs(started_at);`);
    db.prepare("INSERT OR IGNORE INTO scheduler_runtime_state(key,value) VALUES ('paused','false')").run();
  }
  status() { const schedules = this.list(); return { enabled: this.options.enabled, paused: this.paused(), running: !!this.timer, pollIntervalMs: this.options.pollIntervalMs, activeJobs: this.active, maxConcurrentRuns: this.options.maxConcurrentRuns, nextScheduledEvent: schedules.filter(s => s.enabled && s.nextRunAt).map(s => s.nextRunAt!).sort()[0] ?? null, dueCount: schedules.filter(s => s.enabled && s.nextRunAt && s.nextRunAt <= nowIso()).length }; }
  paused(): boolean { return (this.db.prepare("SELECT value FROM scheduler_runtime_state WHERE key='paused'").get() as any)?.value === "true"; }
  pause() { this.db.prepare("UPDATE scheduler_runtime_state SET value='true' WHERE key='paused'").run(); this.audit("paused"); return this.status(); }
  resume() { this.db.prepare("UPDATE scheduler_runtime_state SET value='false' WHERE key='paused'").run(); this.audit("resumed"); return this.status(); }
  private audit(action: string, details: object = {}) { this.db.prepare("INSERT INTO system_events(event_type,message,metadata) VALUES (?,?,?)").run(`scheduler.${action}`, `Scheduler ${action}.`, JSON.stringify(details)); }
  list(): Schedule[] { return (this.db.prepare("SELECT * FROM scheduler_schedules ORDER BY created_at DESC").all() as any[]).map(rowSchedule); }
  get(id: string): Schedule { const row = this.db.prepare("SELECT * FROM scheduler_schedules WHERE id=?").get(id); if (!row) throw new Error("Schedule not found."); return rowSchedule(row); }
  runs(limit = 100): SchedulerRun[] { return (this.db.prepare("SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 500)) as any[]).map(rowRun); }
  preview(input: ScheduleInput) {
    if (!object(input) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 160 || typeof input.actionToolKey !== "string" || !object(input.actionArgs)) throw new Error("Invalid schedule definition.");
    if (JSON.stringify(input.actionArgs).length > 16000) throw new Error("Target arguments are too large.");
    validateConfig(input.scheduleConfig);
    if (input.actionToolKey.startsWith("scheduler.")) throw new Error("Scheduler administration cannot be scheduled.");
    const tool = this.adapter.getTool(input.actionToolKey);
    if (!tool || !tool.enabled || tool.riskLevel === "high_risk") throw new Error("Target tool is unavailable or blocked.");
    const next = nextRun(input.scheduleConfig, new Date());
    if (!next) throw new Error("Schedule has no future occurrence.");
    return { name: input.name.trim(), recurrence: input.scheduleConfig, nextRunAt: next, targetTool: input.actionToolKey, targetArguments: input.actionArgs, projectKey: input.projectKey ?? null, riskLevel: tool.riskLevel, behavior: tool.riskLevel === "read_only" && !tool.requiresApproval ? "AUTO_RUN" : "CREATE_APPROVAL_REQUEST", requiresApproval: tool.riskLevel !== "read_only" };
  }
  create(input: ScheduleInput): Schedule { const preview = this.preview(input); const id = randomUUID(), at = nowIso(); this.db.prepare("INSERT INTO scheduler_schedules(id,name,description,enabled,schedule_config,action_tool_key,action_args,project_key,requires_approval,created_at,updated_at,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id, preview.name, String(input.description ?? "").slice(0, 1000), input.enabled === false ? 0 : 1, JSON.stringify(input.scheduleConfig), input.actionToolKey, JSON.stringify(input.actionArgs), input.projectKey ?? null, Number(preview.requiresApproval), at, at, preview.nextRunAt); this.audit("created", { id, toolKey: input.actionToolKey }); return this.get(id); }
  update(id: string, input: ScheduleInput): Schedule { this.get(id); const preview = this.preview(input); this.db.prepare("UPDATE scheduler_schedules SET name=?,description=?,schedule_config=?,action_tool_key=?,action_args=?,project_key=?,requires_approval=?,next_run_at=?,updated_at=? WHERE id=?").run(preview.name, String(input.description ?? "").slice(0, 1000), JSON.stringify(input.scheduleConfig), input.actionToolKey, JSON.stringify(input.actionArgs), input.projectKey ?? null, Number(preview.requiresApproval), preview.nextRunAt, nowIso(), id); this.audit("updated", { id }); return this.get(id); }
  setEnabled(id: string, enabled: boolean): Schedule { this.get(id); this.db.prepare("UPDATE scheduler_schedules SET enabled=?,updated_at=? WHERE id=?").run(Number(enabled), nowIso(), id); this.audit(enabled ? "enabled" : "disabled", { id }); return this.get(id); }
  delete(id: string) { this.get(id); this.db.prepare("DELETE FROM scheduler_schedules WHERE id=?").run(id); this.audit("deleted", { id }); return { deleted: id, historyRetained: true }; }
  start() { if (!this.options.enabled || this.timer) return; if (!this.options.startupCatchup) this.skipMissed(); this.timer = setInterval(() => { void this.tick().catch(error => this.audit("error", { message: String(error) })); }, this.options.pollIntervalMs); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  skipMissed(at = new Date()) { for (const schedule of this.list()) if (schedule.enabled && schedule.nextRunAt && schedule.nextRunAt < at.toISOString()) { const next = nextRun(schedule.scheduleConfig, at); this.db.prepare("UPDATE scheduler_schedules SET next_run_at=? WHERE id=?").run(next, schedule.id); this.audit("missed_skipped", { id: schedule.id, from: schedule.nextRunAt, next }); } }
  async tick(at = new Date()): Promise<void> {
    if (!this.options.enabled || this.paused() || this.ticking) return;
    this.ticking = true;
    try {
      const due = this.list().filter(s => s.enabled && s.nextRunAt && s.nextRunAt <= at.toISOString()).reverse();
      for (const schedule of due) {
        if (this.paused() || this.active >= this.options.maxConcurrentRuns) break;
        await this.execute(schedule, at);
      }
    } finally { this.ticking = false; }
  }
  private async execute(schedule: Schedule, at: Date) {
    const occurrence = schedule.nextRunAt!;
    const next = nextRun(schedule.scheduleConfig, new Date(Math.max(at.getTime(), Date.parse(occurrence))));
    const runId = randomUUID();
    const claimed = this.db.transaction(() => {
      const insert = this.db.prepare("INSERT OR IGNORE INTO scheduler_runs(id,schedule_id,occurrence,status,started_at) VALUES (?,?,?,'running',?)").run(runId, schedule.id, occurrence, nowIso());
      this.db.prepare("UPDATE scheduler_schedules SET last_run_at=?,next_run_at=? WHERE id=? AND next_run_at=?").run(occurrence, next, schedule.id, occurrence);
      return insert.changes === 1;
    })();
    if (!claimed) return;
    this.active++;
    let status = "failed", requestId: number | null = null, result: unknown = null, error: string | null = null;
    try {
      if (!this.options.enabled || this.paused() || !this.get(schedule.id).enabled) { status = "skipped"; return; }
      const tool = this.adapter.getTool(schedule.actionToolKey);
      if (!tool || !tool.enabled || tool.riskLevel === "high_risk") { status = "blocked"; error = "Tool unavailable or blocked."; return; }
      if (tool.riskLevel === "read_only" && !tool.requiresApproval) { result = await this.adapter.runReadOnly(schedule.actionToolKey, schedule.actionArgs); status = "completed"; }
      else { requestId = this.adapter.request(schedule.actionToolKey, schedule.actionArgs, `Scheduled: ${schedule.name}`).id; status = "pending_approval"; }
    } catch (cause) { error = cause instanceof Error ? cause.message : "Scheduled operation failed."; }
    finally {
      this.db.prepare("UPDATE scheduler_runs SET status=?,completed_at=?,tool_request_id=?,result=?,error=? WHERE id=?").run(status, nowIso(), requestId, result == null ? null : JSON.stringify(result), error, runId);
      this.audit("run", { id: schedule.id, occurrence, status, requestId });
      this.db.prepare("DELETE FROM scheduler_runs WHERE id IN (SELECT id FROM scheduler_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?)").run(this.options.maxRunHistory);
      this.active--;
    }
  }
}

let current: Scheduler | null = null;
export function configureScheduler(scheduler: Scheduler) { current?.stop(); current = scheduler; return scheduler; }
export function getScheduler(): Scheduler { if (!current) throw new Error("Scheduler is not initialized."); return current; }
