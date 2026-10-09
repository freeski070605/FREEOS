import { getToolRegistry } from "@freeos/tool-runner";
import { config } from "../config";

export type RemoteTaskKind = "freeos" | "agent";
export type RemoteTaskStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export interface RemoteTask {
  id: number;
  kind: RemoteTaskKind;
  agentId: number | null;
  projectKey: string | null;
  objective: string;
  priority: number;
  status: RemoteTaskStatus;
  currentStep: string;
  result: string | null;
  error: string | null;
  linkedRunId: number | null;
  approvalIds: number[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

const db = () => getToolRegistry().database;
const parseIds = (value: unknown): number[] => {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
};
const row = (value: any): RemoteTask => ({
  id: Number(value.id), kind: value.kind === "agent" ? "agent" : "freeos", agentId: value.agent_id == null ? null : Number(value.agent_id),
  projectKey: value.project_key ?? null, objective: String(value.objective), priority: Number(value.priority ?? 0), status: value.status,
  currentStep: String(value.current_step ?? "Queued"), result: value.result ?? null, error: value.error ?? null,
  linkedRunId: value.linked_run_id == null ? null : Number(value.linked_run_id), approvalIds: parseIds(value.approval_ids),
  createdAt: String(value.created_at), startedAt: value.started_at ?? null, completedAt: value.completed_at ?? null, updatedAt: String(value.updated_at),
});

export class RemoteOpsService {
  private timer: NodeJS.Timeout | null = null;
  private working = false;

  constructor() {
    db().exec(`
      CREATE TABLE IF NOT EXISTS remote_ops_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO remote_ops_state(id, paused) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS remote_ops_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK(kind IN ('freeos','agent')),
        agent_id INTEGER,
        project_key TEXT,
        objective TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        current_step TEXT NOT NULL DEFAULT 'Queued',
        result TEXT,
        error TEXT,
        linked_run_id INTEGER,
        approval_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_remote_ops_tasks_queue ON remote_ops_tasks(status, priority DESC, id ASC);
    `);
    db().prepare("UPDATE remote_ops_tasks SET status='queued', current_step='Recovered after FREEOS restart', started_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE status='running'").run();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 2_000);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private isPaused(): boolean {
    return !!(db().prepare("SELECT paused FROM remote_ops_state WHERE id=1").get() as { paused: number }).paused;
  }

  status() {
    const counts = db().prepare("SELECT status, COUNT(*) count FROM remote_ops_tasks GROUP BY status").all() as Array<{ status: string; count: number }>;
    const byStatus = Object.fromEntries(counts.map(item => [item.status, Number(item.count)]));
    const active = db().prepare("SELECT * FROM remote_ops_tasks WHERE status='running' ORDER BY id DESC LIMIT 1").get();
    const next = db().prepare("SELECT * FROM remote_ops_tasks WHERE status='queued' ORDER BY priority DESC, id ASC LIMIT 1").get();
    return {
      paused: this.isPaused(), workerOnline: !!this.timer, working: this.working || !!active,
      counts: { queued: byStatus.queued ?? 0, running: byStatus.running ?? 0, waitingApproval: byStatus.waiting_approval ?? 0, completed: byStatus.completed ?? 0, failed: byStatus.failed ?? 0, cancelled: byStatus.cancelled ?? 0 },
      activeTask: active ? row(active) : null,
      nextTask: next ? row(next) : null,
      executionModel: "Single active task; new work queues while FREEOS is busy. Approval-gated actions pause that task without blocking later queued tasks.",
    };
  }

  list(limit = 100): RemoteTask[] {
    const safe = Math.min(Math.max(Number(limit) || 100, 1), 250);
    return (db().prepare("SELECT * FROM remote_ops_tasks ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'waiting_approval' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, priority DESC, id DESC LIMIT ?").all(safe) as any[]).map(row);
  }

  enqueue(input: { kind?: unknown; agentId?: unknown; projectKey?: unknown; objective?: unknown }): RemoteTask {
    const kind: RemoteTaskKind = input.kind === "agent" ? "agent" : "freeos";
    const objective = typeof input.objective === "string" ? input.objective.trim() : "";
    const projectKey = typeof input.projectKey === "string" && input.projectKey.trim() ? input.projectKey.trim() : null;
    const agentId = kind === "agent" ? Number(input.agentId) : null;
    if (!objective || objective.length > 4_000) throw new Error("Task objective is required and must be at most 4000 characters.");
    if (kind === "agent" && (!Number.isInteger(agentId) || Number(agentId) < 1)) throw new Error("Agent tasks require a valid enabled agent ID.");
    const result = db().prepare("INSERT INTO remote_ops_tasks(kind,agent_id,project_key,objective,status,current_step) VALUES (?,?,?,?, 'queued','Queued')").run(kind, agentId, projectKey, objective);
    return this.get(Number(result.lastInsertRowid));
  }

  get(id: number): RemoteTask {
    const value = db().prepare("SELECT * FROM remote_ops_tasks WHERE id=?").get(id);
    if (!value) throw new Error("Remote Ops task not found.");
    return row(value);
  }

  setPaused(paused: boolean) {
    db().prepare("UPDATE remote_ops_state SET paused=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").run(Number(paused));
    return this.status();
  }

  runNext(id: number): RemoteTask {
    const task = this.get(id);
    if (task.status !== "queued") throw new Error("Only queued tasks can be moved to the front.");
    const max = Number((db().prepare("SELECT COALESCE(MAX(priority),0) value FROM remote_ops_tasks WHERE status='queued'").get() as { value: number }).value);
    db().prepare("UPDATE remote_ops_tasks SET priority=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(max + 1, id);
    void this.tick();
    return this.get(id);
  }

  cancel(id: number): RemoteTask {
    const task = this.get(id);
    if (task.status === "running") throw new Error("The active task is already executing. Pause Remote Ops to prevent the next task from starting; active-run cancellation is not yet safe in this worker.");
    if (!["queued", "waiting_approval"].includes(task.status)) throw new Error("Only queued or waiting tasks can be cancelled.");
    db().prepare("UPDATE remote_ops_tasks SET status='cancelled', current_step='Cancelled by owner', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    return this.get(id);
  }

  private reconcileWaiting(): void {
    const tasks = db().prepare("SELECT * FROM remote_ops_tasks WHERE status='waiting_approval'").all() as any[];
    for (const value of tasks) {
      const task = row(value);
      if (!task.approvalIds.length) continue;
      const statuses = task.approvalIds.map(approvalId => (db().prepare("SELECT status FROM tool_requests WHERE id=?").get(approvalId) as { status: string } | undefined)?.status ?? "missing");
      if (statuses.some(status => ["rejected", "blocked", "failed", "missing"].includes(status))) {
        db().prepare("UPDATE remote_ops_tasks SET status='failed', current_step='Approval was rejected, blocked, failed, or missing', error=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(`Approval states: ${statuses.join(", ")}`, task.id);
      } else if (statuses.every(status => status === "completed")) {
        db().prepare("UPDATE remote_ops_tasks SET status='completed', current_step='Approved actions completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(task.id);
      } else {
        db().prepare("UPDATE remote_ops_tasks SET current_step=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(`Waiting on approval/action: ${statuses.join(", ")}`, task.id);
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.working) return;
    this.reconcileWaiting();
    if (this.isPaused()) return;
    const value = db().prepare("SELECT * FROM remote_ops_tasks WHERE status='queued' ORDER BY priority DESC, id ASC LIMIT 1").get();
    if (!value) return;
    const task = row(value);
    this.working = true;
    db().prepare("UPDATE remote_ops_tasks SET status='running', current_step='Starting task', started_at=COALESCE(started_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").run(task.id);
    try {
      await this.execute(this.get(task.id));
    } catch (error) {
      db().prepare("UPDATE remote_ops_tasks SET status='failed', current_step='Task failed', error=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(error instanceof Error ? error.message.slice(0, 4_000) : "Remote Ops task failed.", task.id);
    } finally {
      this.working = false;
    }
    queueMicrotask(() => { void this.tick(); });
  }

  private async internalPost(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    try {
      const response = await fetch(`http://127.0.0.1:${config.port}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const payload = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Task endpoint returned HTTP ${response.status}.`);
      return payload;
    } finally { clearTimeout(timer); }
  }

  private async execute(task: RemoteTask): Promise<void> {
    if (task.kind === "agent") {
      db().prepare("UPDATE remote_ops_tasks SET current_step='Agent is planning and working', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(task.id);
      const payload = await this.internalPost(`/agents/${task.agentId}/run`, { projectKey: task.projectKey ?? "", objective: task.objective, toolRequests: [] });
      const run = payload.run ?? {};
      const approvalIds = Array.isArray(run.approvalsCreated) ? run.approvalsCreated.map(Number).filter(Number.isFinite) : [];
      const waiting = run.status === "waiting_approval" || approvalIds.length > 0;
      db().prepare("UPDATE remote_ops_tasks SET status=?, current_step=?, result=?, linked_run_id=?, approval_ids=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(waiting ? "waiting_approval" : "completed", waiting ? "Waiting for owner approval" : "Agent task completed", typeof run.result === "string" ? run.result : JSON.stringify(run), Number.isFinite(Number(run.id)) ? Number(run.id) : null, JSON.stringify(approvalIds), waiting ? null : new Date().toISOString(), task.id);
      return;
    }

    db().prepare("UPDATE remote_ops_tasks SET current_step='FREEOS is thinking', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(task.id);
    const payload = await this.internalPost("/command/chat", {
      message: task.objective,
      projectKey: task.projectKey ?? undefined,
      useMemory: true,
      useProjectNotes: true,
      useCurrentIntelligence: true,
      allowToolSuggestions: true,
      responseMode: "precise",
    });
    const approvalIds = payload.createdToolRequestId ? [Number(payload.createdToolRequestId)] : [];
    const waiting = approvalIds.length > 0;
    db().prepare("UPDATE remote_ops_tasks SET status=?, current_step=?, result=?, approval_ids=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(waiting ? "waiting_approval" : "completed", waiting ? "Waiting for owner approval" : "FREEOS task completed", typeof payload.response === "string" ? payload.response : JSON.stringify(payload), JSON.stringify(approvalIds), waiting ? null : new Date().toISOString(), task.id);
  }
}

export const remoteOpsService = new RemoteOpsService();
