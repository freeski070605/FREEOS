import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, type CommandActivity, type Project, type ToolRun } from "../lib/api";
import { ApprovalHub } from "./ApprovalHub";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

type TaskStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
interface RemoteTask {
  id: number; kind: "freeos" | "agent"; agentId: number | null; projectKey: string | null; objective: string; priority: number;
  status: TaskStatus; currentStep: string; result: string | null; error: string | null; linkedRunId: number | null; approvalIds: number[];
  createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string;
}
interface RemoteStatus {
  paused: boolean; workerOnline: boolean; working: boolean;
  counts: { queued: number; running: number; waitingApproval: number; completed: number; failed: number; cancelled: number };
  activeTask: RemoteTask | null; nextTask: RemoteTask | null; executionModel: string;
}
interface Agent { id: number; name: string; enabled: boolean; projectKeys: string[]; templateKey: string }
interface ComputerStatus { controlEnabled: boolean; screenCaptureEnabled: boolean; observationAvailable: boolean; activeWindow: { processName: string; windowTitle: string } | null }
interface SnapshotResponse { snapshot: { url: string; width: number; height: number; timestamp: string } }

async function remoteJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `Remote Ops returned HTTP ${response.status}.`);
  return payload as T;
}

const statusBadge = (status: TaskStatus) => status === "running" ? "badge-warn" : status === "completed" ? "badge-safe" : "badge";

export function RemoteOpsPanel() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [tasks, setTasks] = useState<RemoteTask[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [activity, setActivity] = useState<CommandActivity[]>([]);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ kind: "freeos" as "freeos" | "agent", agentId: "", projectKey: "", objective: "" });

  const enabledAgents = useMemo(() => agents.filter(agent => agent.enabled), [agents]);
  const selectedAgent = enabledAgents.find(agent => String(agent.id) === draft.agentId);
  const eligibleProjects = selectedAgent ? projects.filter(project => selectedAgent.projectKeys.includes(project.projectKey)) : projects;

  const refresh = useCallback(async () => {
    const settled = await Promise.allSettled([
      remoteJson<RemoteStatus>("/remote-ops/status"),
      remoteJson<{ tasks: RemoteTask[] }>("/remote-ops/tasks?limit=100"),
      remoteJson<{ agents: Agent[] }>("/agents"),
      api.projects(),
      remoteJson<ComputerStatus>("/computer/status"),
      api.toolRuns(),
      api.commandActivity(12),
    ]);
    if (settled[0].status === "fulfilled") setStatus(settled[0].value);
    if (settled[1].status === "fulfilled") setTasks(settled[1].value.tasks);
    if (settled[2].status === "fulfilled") setAgents(settled[2].value.agents);
    if (settled[3].status === "fulfilled") setProjects(settled[3].value);
    if (settled[4].status === "fulfilled") setComputer(settled[4].value);
    if (settled[5].status === "fulfilled") setRuns(settled[5].value);
    if (settled[6].status === "fulfilled") setActivity(settled[6].value);
    const failed = settled.find(item => item.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) setNotice(failed.reason instanceof Error ? failed.reason.message : "Some Remote Ops telemetry is unavailable.");
  }, []);

  const capture = useCallback(async () => {
    if (!computer?.screenCaptureEnabled) return;
    const result = await remoteJson<SnapshotResponse>("/computer/snapshot", { method: "POST", body: "{}" });
    setSnapshotUrl(`${API_BASE}${result.snapshot.url}?t=${Date.now()}`);
  }, [computer?.screenCaptureEnabled]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 3_000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { if (!livePreview) return; void capture(); const timer = window.setInterval(() => void capture().catch(error => setNotice(error instanceof Error ? error.message : "Preview unavailable.")), 10_000); return () => window.clearInterval(timer); }, [livePreview, capture]);
  useEffect(() => {
    if (draft.kind === "agent" && !draft.agentId && enabledAgents[0]) setDraft(value => ({ ...value, agentId: String(enabledAgents[0].id), projectKey: enabledAgents[0].projectKeys[0] ?? "" }));
  }, [draft.kind, draft.agentId, enabledAgents]);

  async function act(key: string, operation: () => Promise<unknown>, message?: string) {
    setBusy(key); setNotice(null);
    try { await operation(); if (message) setNotice(message); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Remote Ops action failed."); }
    finally { setBusy(null); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void act("enqueue", async () => {
      await remoteJson("/remote-ops/tasks", { method: "POST", body: JSON.stringify({ kind: draft.kind, agentId: draft.kind === "agent" ? Number(draft.agentId) : undefined, projectKey: draft.projectKey || undefined, objective: draft.objective }) });
      setDraft(value => ({ ...value, objective: "" }));
    }, "Task added to the queue. FREEOS can keep working while you add more.");
  }

  const currentRun = runs.find(run => run.status === "running") ?? runs[0] ?? null;
  const mode = status?.paused ? "PAUSED" : status?.working ? "WORKING" : status?.counts.waitingApproval ? "WAITING" : "IDLE";

  return <div className="space-y-4">
    <section className="panel border-electric/20 bg-electric/[.03]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="eyebrow">Away-from-PC command center</p><h2 className="section-title">Remote Ops</h2><p className="section-copy">Queue work from your phone, watch FREEOS move through tasks, handle approvals, and keep new jobs lined up while the computer stays home.</p></div>
        <span className={`badge ${mode === "WORKING" ? "badge-warn" : mode === "IDLE" ? "badge-safe" : ""}`}>{mode}</span>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[
        ["Worker", status?.workerOnline ? "Online" : "Offline"], ["Queued", status?.counts.queued ?? "—"], ["Running", status?.counts.running ?? "—"],
        ["Waiting", status?.counts.waitingApproval ?? "—"], ["Completed", status?.counts.completed ?? "—"], ["Computer", computer?.controlEnabled ? "Control enabled" : "Control locked"],
      ].map(([label,value]) => <div key={label} className="queue-item"><p className="meta mt-0">{label}</p><p className="m-0 text-sm text-slate-200">{value}</p></div>)}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="button" disabled={!!busy || !status} onClick={() => void act("pause", () => remoteJson(status?.paused ? "/remote-ops/resume" : "/remote-ops/pause", { method: "POST", body: "{}" }), status?.paused ? "Remote Ops resumed." : "Queue paused. The active task is allowed to finish safely; no new task will start.")}>{status?.paused ? "Resume queue" : "Pause after current"}</button>
        <button className="button" disabled={!!busy} onClick={() => void refresh()}>Refresh now</button>
      </div>
      <p className="meta">The API still listens only on this PC. Remote mode exposes the dashboard through your private Tailscale address and proxies API calls locally; port 3001 is not opened to the network.</p>
    </section>

    <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
      <section className="panel">
        <p className="eyebrow">Keep feeding the queue</p><h3 className="section-title">Add another task</h3>
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <select className="field" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as "freeos" | "agent", agentId: "", projectKey: "" })}>
            <option value="freeos">FREEOS general task</option><option value="agent">Run an enabled specialist agent</option>
          </select>
          {draft.kind === "agent" && <select className="field" required value={draft.agentId} onChange={event => { const agent = enabledAgents.find(item => String(item.id) === event.target.value); setDraft({ ...draft, agentId: event.target.value, projectKey: agent?.projectKeys[0] ?? "" }); }}><option value="">Choose enabled agent</option>{enabledAgents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.templateKey}</option>)}</select>}
          <select className="field" value={draft.projectKey} onChange={event => setDraft({ ...draft, projectKey: event.target.value })}><option value="">Global / no project</option>{eligibleProjects.map(project => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>)}</select>
          <textarea className="field min-h-36" required maxLength={4000} placeholder="What do you want FREEOS to work on while you're out?" value={draft.objective} onChange={event => setDraft({ ...draft, objective: event.target.value })}/>
          <button className="button" disabled={!!busy || (draft.kind === "agent" && !draft.agentId)}>Add to queue</button>
        </form>
        {draft.kind === "agent" && enabledAgents.length === 0 && <p className="notice">No enabled specialist agents are available yet. General FREEOS tasks still work; enable an agent in Advanced Systems → Agents when you want agent-mode jobs.</p>}
      </section>

      <section className="panel">
        <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">What the home PC is doing</p><h3 className="section-title">Live work view</h3></div><button className="button" disabled={!computer?.screenCaptureEnabled} onClick={() => setLivePreview(value => !value)}>{livePreview ? "Stop preview" : "Live preview"}</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{[
          ["Current task", status?.activeTask ? `#${status.activeTask.id} ${status.activeTask.objective}` : "No active task"],
          ["Current step", status?.activeTask?.currentStep ?? "Idle"],
          ["Active app", computer?.activeWindow?.processName ?? "Unavailable"],
          ["Active window", computer?.activeWindow?.windowTitle ?? "Unavailable"],
          ["Current tool", currentRun ? `${currentRun.toolKey} · ${currentRun.status}` : "No recent tool run"],
          ["Next task", status?.nextTask ? `#${status.nextTask.id} ${status.nextTask.objective}` : "Queue clear"],
        ].map(([label,value]) => <div key={label} className="queue-item min-w-0"><p className="meta mt-0">{label}</p><p className="m-0 break-words text-sm text-slate-200">{value}</p></div>)}</div>
        {!computer?.screenCaptureEnabled && <p className="notice">Screen capture is still opt-in. Enable the existing FREEOS screen-capture switch before remote live preview can show the desktop.</p>}
        {snapshotUrl ? <img className="mt-4 w-full border border-white/10 bg-black/30 object-contain" src={snapshotUrl} alt="Latest FREEOS desktop snapshot"/> : <div className="empty mt-4">Desktop preview is off. Turn on Live preview for a new snapshot about every 10 seconds.</div>}
      </section>
    </div>

    <section className="panel">
      <p className="eyebrow">Persistent queue</p><h3 className="section-title">Tasks</h3>
      <div className="mt-4 space-y-2">{tasks.length === 0 && <div className="empty">No Remote Ops tasks yet.</div>}{tasks.map(task => <article key={task.id} className="queue-item">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="m-0 text-sm font-semibold text-white">#{task.id} · {task.objective}</p><p className="meta">{task.kind}{task.agentId ? ` · agent #${task.agentId}` : ""} · {task.projectKey ?? "global"} · {task.currentStep}</p></div><span className={`badge ${statusBadge(task.status)}`}>{task.status.replace("_", " ")}</span></div>
        {task.error && <p className="notice">{task.error}</p>}
        {task.result && <details className="mt-2"><summary className="cursor-pointer text-xs text-slate-400">Task result</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs text-slate-300">{task.result}</pre></details>}
        <div className="mt-3 flex flex-wrap gap-2">{task.status === "queued" && <><button className="button" disabled={!!busy} onClick={() => void act(`next-${task.id}`, () => remoteJson(`/remote-ops/tasks/${task.id}/run-next`, { method: "POST", body: "{}" }), `Task #${task.id} moved to the front.`)}>Run next</button><button className="button" disabled={!!busy} onClick={() => void act(`cancel-${task.id}`, () => remoteJson(`/remote-ops/tasks/${task.id}/cancel`, { method: "POST", body: "{}" }), `Task #${task.id} cancelled.`)}>Cancel</button></>}{task.status === "waiting_approval" && <button className="button" disabled={!!busy} onClick={() => void act(`cancel-${task.id}`, () => remoteJson(`/remote-ops/tasks/${task.id}/cancel`, { method: "POST", body: "{}" }), `Task #${task.id} cancelled. Existing approval requests remain separately governed.`)}>Cancel task</button>}</div>
      </article>)}</div>
    </section>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel"><p className="eyebrow">Recent execution</p><h3 className="section-title">Tool activity</h3><div className="mt-4 space-y-2">{runs.slice(0,10).map(run => <div key={run.id} className="queue-item"><div className="flex justify-between gap-2"><p className="m-0 font-mono text-xs text-white">#{run.id} {run.toolKey}</p><span className="meta mt-0">{run.status}</span></div><p className="meta">{run.startedAt} → {run.finishedAt ?? "running"}</p></div>)}{!runs.length && <div className="empty">No tool activity.</div>}</div></section>
      <section className="panel"><p className="eyebrow">Audit stream</p><h3 className="section-title">Recent FREEOS activity</h3><div className="mt-4 space-y-2">{activity.map(item => <div key={`${item.type}-${item.id}`} className="queue-item"><div className="flex justify-between gap-2"><p className="m-0 text-sm text-white">{item.title}</p><span className="meta mt-0">{item.status}</span></div><p className="mb-0 mt-1 line-clamp-2 text-xs text-slate-500">{item.message}</p></div>)}{!activity.length && <div className="empty">No recent activity.</div>}</div></section>
    </div>

    <ApprovalHub />
  </div>;
}
