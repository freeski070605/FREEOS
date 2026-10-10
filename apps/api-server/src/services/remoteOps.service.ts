import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getToolRegistry, ToolRequests } from "@freeos/tool-runner";
import { getOperatorStatus, type OperatorKey } from "@freeos/operator-core";
import { config } from "../config";
import { generateWithOllama } from "./ollama.service";

export type RemoteTaskKind = "freeos" | "agent";
export type RemoteTaskStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export interface RemoteTask {
  id: number;
  kind: RemoteTaskKind;
  agentId: number | null;
  operatorKey: OperatorKey | null;
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
  operatorKey: value.operator_key ? String(value.operator_key) as OperatorKey : null,
  projectKey: value.project_key ?? null, objective: String(value.objective), priority: Number(value.priority ?? 0), status: value.status,
  currentStep: String(value.current_step ?? "Queued"), result: value.result ?? null, error: value.error ?? null,
  linkedRunId: value.linked_run_id == null ? null : Number(value.linked_run_id), approvalIds: parseIds(value.approval_ids),
  createdAt: String(value.created_at), startedAt: value.started_at ?? null, completedAt: value.completed_at ?? null, updatedAt: String(value.updated_at),
});

function jsonObject(text: string): Record<string, any> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Local model did not return a JSON object.");
  const parsed = JSON.parse(cleaned.slice(first, last + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Local model returned an invalid Blender plan.");
  return parsed;
}

function fallbackBlenderPlan(jobKey: string): Record<string, any> {
  const skin = "Skin"; const shirt = "Shirt"; const pants = "Pants"; const shoe = "Shoes"; const hair = "Hair"; const accent = "Accent"; const white = "EyeWhite"; const dark = "Dark";
  return {
    jobKey,
    blendFile: "character.blend",
    scene: { resolution: [768, 768], worldColor: [0.025, 0.025, 0.035] },
    materials: [
      { name: skin, baseColor: [0.34, 0.16, 0.08, 1], roughness: 0.55 },
      { name: shirt, baseColor: [0.05, 0.07, 0.10, 1], roughness: 0.45 },
      { name: pants, baseColor: [0.035, 0.035, 0.045, 1], roughness: 0.6 },
      { name: shoe, baseColor: [0.08, 0.08, 0.09, 1], roughness: 0.4 },
      { name: hair, baseColor: [0.015, 0.012, 0.012, 1], roughness: 0.75 },
      { name: accent, baseColor: [0.05, 0.32, 0.72, 1], metallic: 0.15, roughness: 0.3 },
      { name: white, baseColor: [0.9, 0.9, 0.86, 1], roughness: 0.35 },
      { name: dark, baseColor: [0.01, 0.01, 0.01, 1], roughness: 0.25 },
    ],
    objects: [
      { name: "Torso", type: "cube", location: [0, 0, 2.75], scale: [1.05, 0.62, 1.2], bevel: 0.28, material: shirt },
      { name: "Pelvis", type: "cube", location: [0, 0, 1.45], scale: [0.82, 0.55, 0.48], bevel: 0.22, material: pants },
      { name: "Neck", type: "cylinder", location: [0, 0, 4.05], scale: [0.32, 0.32, 0.34], material: skin },
      { name: "Head", type: "uv_sphere", location: [0, 0, 4.9], scale: [0.86, 0.78, 0.98], material: skin },
      { name: "HairCap", type: "uv_sphere", location: [0, 0.02, 5.35], scale: [0.88, 0.79, 0.52], material: hair },
      { name: "LeftEyeWhite", type: "uv_sphere", location: [-0.29, -0.72, 5.02], scale: [0.20, 0.09, 0.14], material: white },
      { name: "RightEyeWhite", type: "uv_sphere", location: [0.29, -0.72, 5.02], scale: [0.20, 0.09, 0.14], material: white },
      { name: "LeftPupil", type: "uv_sphere", location: [-0.29, -0.805, 5.02], scale: [0.075, 0.035, 0.075], material: dark },
      { name: "RightPupil", type: "uv_sphere", location: [0.29, -0.805, 5.02], scale: [0.075, 0.035, 0.075], material: dark },
      { name: "LeftArm", type: "cylinder", location: [-1.28, 0, 2.65], rotation: [0, 0, -8], scale: [0.34, 0.34, 1.18], material: skin },
      { name: "RightArm", type: "cylinder", location: [1.28, 0, 2.65], rotation: [0, 0, 8], scale: [0.34, 0.34, 1.18], material: skin },
      { name: "LeftSleeve", type: "cylinder", location: [-1.08, 0, 3.25], rotation: [0, 0, -8], scale: [0.43, 0.43, 0.62], material: shirt },
      { name: "RightSleeve", type: "cylinder", location: [1.08, 0, 3.25], rotation: [0, 0, 8], scale: [0.43, 0.43, 0.62], material: shirt },
      { name: "LeftHand", type: "uv_sphere", location: [-1.47, 0, 1.62], scale: [0.38, 0.32, 0.42], material: skin },
      { name: "RightHand", type: "uv_sphere", location: [1.47, 0, 1.62], scale: [0.38, 0.32, 0.42], material: skin },
      { name: "LeftLeg", type: "cylinder", location: [-0.48, 0, 0.05], scale: [0.43, 0.43, 1.35], material: pants },
      { name: "RightLeg", type: "cylinder", location: [0.48, 0, 0.05], scale: [0.43, 0.43, 1.35], material: pants },
      { name: "LeftShoe", type: "cube", location: [-0.48, -0.24, -1.25], scale: [0.55, 0.82, 0.28], bevel: 0.18, material: shoe },
      { name: "RightShoe", type: "cube", location: [0.48, -0.24, -1.25], scale: [0.55, 0.82, 0.28], bevel: 0.18, material: shoe },
      { name: "ChestAccent", type: "cube", location: [0, -0.64, 3.0], scale: [0.44, 0.06, 0.18], bevel: 0.08, material: accent },
    ],
    camera: { name: "Camera", location: [0, -14, 3.2], rotation: [78, 0, 0], lens: 58 },
    lights: [
      { name: "Key", type: "AREA", location: [-4, -6, 8], rotation: [35, 0, -25], energy: 1100, size: 5, color: [1, 0.86, 0.72] },
      { name: "Fill", type: "AREA", location: [4, -3, 5], rotation: [65, 0, 145], energy: 650, size: 4, color: [0.45, 0.65, 1] },
      { name: "Rim", type: "AREA", location: [0, 4, 7], rotation: [-45, 0, 180], energy: 900, size: 3, color: [0.25, 0.45, 1] },
    ],
    render: { enabled: true, fileName: "preview.png" },
  };
}

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
    const columns = db().pragma("table_info(remote_ops_tasks)") as Array<{ name: string }>;
    if (!columns.some(column => column.name === "operator_key")) db().exec("ALTER TABLE remote_ops_tasks ADD COLUMN operator_key TEXT");
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
      executionModel: "Single active task; operator jobs can generate governed work, pause for approval, and verify deliverables before completion.",
    };
  }

  list(limit = 100): RemoteTask[] {
    const safe = Math.min(Math.max(Number(limit) || 100, 1), 250);
    return (db().prepare("SELECT * FROM remote_ops_tasks ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'waiting_approval' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, priority DESC, id DESC LIMIT ?").all(safe) as any[]).map(row);
  }

  enqueue(input: { kind?: unknown; agentId?: unknown; operatorKey?: unknown; projectKey?: unknown; objective?: unknown }): RemoteTask {
    const kind: RemoteTaskKind = input.kind === "agent" ? "agent" : "freeos";
    const objective = typeof input.objective === "string" ? input.objective.trim() : "";
    const projectKey = typeof input.projectKey === "string" && input.projectKey.trim() ? input.projectKey.trim() : null;
    const agentId = kind === "agent" ? Number(input.agentId) : null;
    const operatorKey = typeof input.operatorKey === "string" && input.operatorKey.trim() ? input.operatorKey.trim() as OperatorKey : null;
    if (!objective || objective.length > 4_000) throw new Error("Task objective is required and must be at most 4000 characters.");
    if (kind === "agent" && (!Number.isInteger(agentId) || Number(agentId) < 1)) throw new Error("Agent tasks require a valid enabled agent ID.");
    if (kind === "agent" && operatorKey) throw new Error("Choose either a specialist agent or a production operator for one task.");
    if (operatorKey) getOperatorStatus(operatorKey);
    const result = db().prepare("INSERT INTO remote_ops_tasks(kind,agent_id,operator_key,project_key,objective,status,current_step) VALUES (?,?,?,?,?, 'queued','Queued')").run(kind, agentId, operatorKey, projectKey, objective);
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

  private operatorManifest(task: RemoteTask): Record<string, unknown> | null {
    if (task.operatorKey !== "blender") return null;
    const path = join(getToolRegistry().rootDir, "generated", "operators", "blender", "jobs", `remote-task-${task.id}`, "manifest.json");
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { return null; }
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
        if (task.operatorKey === "blender") {
          const manifest = this.operatorManifest(task);
          if (!manifest || manifest.ok !== true || !manifest.blendFile) {
            db().prepare("UPDATE remote_ops_tasks SET status='failed', current_step='Blender finished but deliverables could not be verified', error=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .run("Expected Blender manifest/.blend output was not found.", task.id);
            continue;
          }
          db().prepare("UPDATE remote_ops_tasks SET status='completed', current_step='Blender deliverables verified', result=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(JSON.stringify({ operator: "blender", verified: true, manifest }, null, 2), task.id);
        } else {
          db().prepare("UPDATE remote_ops_tasks SET status='completed', current_step='Approved operator action completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(task.id);
        }
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

  private async buildBlenderPlan(task: RemoteTask): Promise<string> {
    const root = getToolRegistry().rootDir;
    const plans = join(root, "generated", "operators", "blender", "plans");
    mkdirSync(plans, { recursive: true });
    const jobKey = `remote-task-${task.id}`;
    const system = `You are FREEOS Blender Planner. Convert the user's objective into ONE JSON scene plan for a fixed Blender driver. Return JSON only, no markdown. You may use only these object types: cube, uv_sphere, ico_sphere, cylinder, cone, torus. Build stylized production blockouts from primitives. Plan schema: {jobKey,blendFile,scene:{resolution:[x,y],worldColor:[r,g,b]},materials:[{name,baseColor:[r,g,b,a],metallic,roughness}],objects:[{name,type,location:[x,y,z],rotation:[deg,deg,deg],scale:[x,y,z],material,smooth,bevel}],camera:{name,location:[x,y,z],rotation:[deg,deg,deg],lens},lights:[{name,type,location,rotation,energy,size,color:[r,g,b]}],render:{enabled:true,fileName:"preview.png"}}. Keep <=80 objects. Do not include code, file paths, scripts, URLs, commands, or unsupported Blender features. Make the composition visible from the camera.`;
    let plan: Record<string, any>;
    try {
      const raw = await generateWithOllama({ model: config.defaultModel, system, prompt: task.objective, timeoutMs: config.ollamaGenerateTimeoutMs, options: { temperature: 0.55, top_p: 0.88, repeat_penalty: 1.08, num_predict: 2600 } });
      plan = jsonObject(raw);
      if (!Array.isArray(plan.objects) || plan.objects.length < 1 || !Array.isArray(plan.materials)) throw new Error("Generated plan is incomplete.");
    } catch {
      plan = fallbackBlenderPlan(jobKey);
    }
    plan.jobKey = jobKey;
    plan.blendFile = "character.blend";
    plan.render = { ...(plan.render && typeof plan.render === "object" ? plan.render : {}), enabled: true, fileName: "preview.png" };
    const path = join(plans, `${jobKey}.json`);
    writeFileSync(path, JSON.stringify(plan, null, 2), "utf8");
    return path;
  }

  private async executeOperator(task: RemoteTask): Promise<void> {
    const operatorKey = task.operatorKey!;
    const status = getOperatorStatus(operatorKey);
    if (!status.ready) throw new Error(`${status.name} is not ready. Configure ${status.envVar} to the exact installed executable path first.`);

    const requests = new ToolRequests(getToolRegistry());
    if (operatorKey === "blender") {
      db().prepare("UPDATE remote_ops_tasks SET current_step='Planning governed Blender scene', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(task.id);
      const planPath = await this.buildBlenderPlan(task);
      const request = requests.createToolRequest({
        toolKey: "operator.blender.run_plan",
        title: `Remote Ops #${task.id}: run Blender build`,
        description: `FREEOS generated a governed Blender scene plan for task #${task.id}. Approve to execute it through the fixed Blender driver.`,
        args: { planPath },
        requestedBy: `remote-ops:${task.id}`,
      });
      db().prepare("UPDATE remote_ops_tasks SET status='waiting_approval', current_step='Blender plan ready — waiting for owner approval', result=?, approval_ids=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(JSON.stringify({ operator: "blender", planPath, note: "Plan generated; execution has not run yet." }, null, 2), JSON.stringify([request.id]), task.id);
      return;
    }

    const request = requests.createToolRequest({
      toolKey: "operator.app.launch",
      title: `Remote Ops #${task.id}: launch ${status.name}`,
      description: `${status.name} is configured for UI production control. This first adapter step launches the app; task-specific native automation remains operator-dependent.`,
      args: { operatorKey },
      requestedBy: `remote-ops:${task.id}`,
    });
    db().prepare("UPDATE remote_ops_tasks SET status='waiting_approval', current_step='Waiting to launch production operator', result=?, approval_ids=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(JSON.stringify({ operator: operatorKey, capability: "launch+ui-control", note: "Native task adapter is not yet available for this application." }, null, 2), JSON.stringify([request.id]), task.id);
  }

  private async execute(task: RemoteTask): Promise<void> {
    if (task.operatorKey) { await this.executeOperator(task); return; }

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
