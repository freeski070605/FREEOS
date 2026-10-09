import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CommandActivity, type ToolRequest, type ToolRun } from "../lib/api";
import { ApprovalHub } from "./ApprovalHub";

interface WindowInfo { processId: number; processName: string; windowTitle: string; visible: boolean }
interface ComputerStatus {
  platform: string;
  supported: boolean;
  health: string;
  controlEnabled: boolean;
  screenCaptureEnabled: boolean;
  observationAvailable: boolean;
  primaryResolution: { width: number; height: number } | null;
  activeWindow: WindowInfo | null;
  visibleWindowCount: number | null;
  processCount: number | null;
}
interface Snapshot {
  relativePath: string;
  width: number;
  height: number;
  timestamp: string;
  url: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const actions = [
  ["computer.window.focus", "Focus window"],
  ["computer.app.launch", "Launch app"],
  ["computer.mouse.move", "Move mouse"],
  ["computer.mouse.click", "Click mouse"],
  ["computer.keyboard.type", "Type text"],
  ["computer.keyboard.press", "Press key"],
  ["computer.keyboard.hotkey", "Hotkey"],
] as const;
const keys = ["Tab", "Escape", "Left", "Right", "Up", "Down", "Home", "End", "PageUp", "PageDown", "Backspace", "Space"];
const hotkeys = ["CTRL+A", "CTRL+C", "CTRL+Z", "CTRL+Y", "CTRL+F", "SHIFT+TAB"];
const monitoredPrefixes = ["computer.", "browser.", "coding.", "agent.", "scheduler.", "automation."];

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Computer monitor returned HTTP ${response.status}.`);
  return payload;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

function runLabel(run: ToolRun | null): string {
  if (!run) return "No active tool action";
  return run.toolKey.replaceAll(".", " › ");
}

export function ComputerPanel() {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [requests, setRequests] = useState<ToolRequest[]>([]);
  const [activity, setActivity] = useState<CommandActivity[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [liveTelemetry, setLiveTelemetry] = useState(true);
  const [autoPreview, setAutoPreview] = useState(false);
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [toolKey, setToolKey] = useState<string>(actions[0][0]);
  const [pid, setPid] = useState("");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [button, setButton] = useState("left");
  const [text, setText] = useState("");
  const [key, setKey] = useState("Tab");
  const [hotkey, setHotkey] = useState("CTRL+A");
  const [executable, setExecutable] = useState("C:\\Windows\\System32\\notepad.exe");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const [queueVersion, setQueueVersion] = useState(0);

  const refreshTelemetry = useCallback(async (showBusy = false) => {
    if (showBusy) setTelemetryBusy(true);
    const settled = await Promise.allSettled([
      requestJson<ComputerStatus>("/computer/status"),
      api.toolRuns(),
      api.toolRequests(),
      api.commandActivity(40),
    ]);
    if (settled[0].status === "fulfilled") setStatus(settled[0].value);
    if (settled[1].status === "fulfilled") setRuns(settled[1].value);
    if (settled[2].status === "fulfilled") setRequests(settled[2].value);
    if (settled[3].status === "fulfilled") setActivity(settled[3].value);
    const failed = settled.find(result => result.status === "rejected");
    if (failed?.status === "rejected") setNotice(failed.reason instanceof Error ? failed.reason.message : "Autonomy telemetry unavailable.");
    else setNotice("");
    setLastRefresh(new Date().toISOString());
    if (showBusy) setTelemetryBusy(false);
  }, []);

  const captureSnapshot = useCallback(async () => {
    setSnapshotBusy(true);
    try {
      const result = await requestJson<{ snapshot: Snapshot }>("/computer/snapshot", { method: "POST" });
      setSnapshot(result.snapshot);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Desktop preview unavailable.");
      setAutoPreview(false);
    } finally {
      setSnapshotBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshTelemetry();
    if (!liveTelemetry) return;
    const timer = window.setInterval(() => { void refreshTelemetry(); }, 3000);
    return () => window.clearInterval(timer);
  }, [liveTelemetry, refreshTelemetry]);

  useEffect(() => {
    if (!autoPreview || !status?.screenCaptureEnabled) return;
    void captureSnapshot();
    const timer = window.setInterval(() => { void captureSnapshot(); }, 10000);
    return () => window.clearInterval(timer);
  }, [autoPreview, captureSnapshot, status?.screenCaptureEnabled]);

  const monitoredRuns = useMemo(() => runs.filter(run => monitoredPrefixes.some(prefix => run.toolKey.startsWith(prefix))), [runs]);
  const activeRun = useMemo(() => monitoredRuns.find(run => !run.finishedAt || run.status.toLowerCase() === "running") ?? null, [monitoredRuns]);
  const pendingRequests = useMemo(() => requests.filter(request => request.status === "pending" || request.status === "approved"), [requests]);
  const monitorState = activeRun ? "WORKING" : pendingRequests.length ? "WAITING" : "IDLE";
  const snapshotUrl = snapshot ? `${API_BASE_URL}${snapshot.url}?t=${encodeURIComponent(snapshot.timestamp)}` : null;

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Computer operation unavailable."); }
    finally { setBusy(false); }
  }

  const launch = toolKey === "computer.app.launch";
  const mouse = toolKey.startsWith("computer.mouse.");
  const args: Record<string, unknown> = launch ? { executable, args: [] } : { processId: Number(pid) };
  if (mouse) Object.assign(args, { x: Number(x), y: Number(y) });
  if (toolKey === "computer.mouse.click") args.button = button;
  if (toolKey === "computer.keyboard.type") args.text = text;
  if (toolKey === "computer.keyboard.press") args.key = key;
  if (toolKey === "computer.keyboard.hotkey") args.hotkey = hotkey;

  async function observe(kind: "windows" | "processes") {
    const result = kind === "windows"
      ? await requestJson<{ windows: WindowInfo[] }>("/computer/windows")
      : await requestJson<{ processes: unknown[] }>("/computer/processes");
    setOutput(result);
    if (kind === "windows") setWindows((result as { windows: WindowInfo[] }).windows);
  }

  return <div className="space-y-4">
    <section className="border border-signal/25 bg-signal/[.035] p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Live command visibility</p>
          <h2 className="section-title">Autonomy Monitor</h2>
          <p className="section-copy max-w-3xl">Watch what FREEOS is doing on the computer: active application, current tool action, approval waits, recent runs, and an optional rolling desktop preview. This monitor observes activity; it does not bypass any approval or safety gate.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`badge ${monitorState === "WORKING" ? "badge-warn" : "badge-safe"}`}>{monitorState}</span>
          <span className="badge">{liveTelemetry ? "LIVE TELEMETRY" : "PAUSED"}</span>
        </div>
      </div>

      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="queue-item min-w-0"><p className="meta mt-0">Active app</p><p className="m-0 break-words text-sm text-white">{status?.activeWindow?.processName ?? "None detected"}</p></div>
        <div className="queue-item min-w-0 xl:col-span-2"><p className="meta mt-0">Active window</p><p className="m-0 break-words text-sm text-white">{status?.activeWindow?.windowTitle ?? "No active window"}</p></div>
        <div className="queue-item min-w-0"><p className="meta mt-0">Current action</p><p className="m-0 break-words text-sm text-white">{runLabel(activeRun)}</p></div>
        <div className="queue-item min-w-0"><p className="meta mt-0">Approval waits</p><p className="m-0 text-sm text-white">{pendingRequests.length}</p></div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="button" disabled={telemetryBusy} onClick={() => void refreshTelemetry(true)}>{telemetryBusy ? "Refreshing…" : "Refresh now"}</button>
        <button className="button" onClick={() => setLiveTelemetry(value => !value)}>{liveTelemetry ? "Pause telemetry" : "Resume telemetry"}</button>
        <button className="button" disabled={snapshotBusy || !status?.screenCaptureEnabled} onClick={() => void captureSnapshot()}>{snapshotBusy ? "Capturing…" : "Capture desktop"}</button>
        <button className="button" disabled={!status?.screenCaptureEnabled} onClick={() => setAutoPreview(value => !value)}>{autoPreview ? "Stop auto preview" : "Auto preview · 10s"}</button>
        <span className="meta">Updated {formatTime(lastRefresh)}</span>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <div className="overflow-hidden border border-white/10 bg-black/30">
          <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3"><div><p className="meta mt-0">Desktop preview</p><p className="m-0 text-xs text-slate-500">Snapshots are local, opt-in, and retained by FREEOS's existing rolling screenshot policy.</p></div><span className={`badge ${status?.screenCaptureEnabled ? "badge-safe" : ""}`}>{status?.screenCaptureEnabled ? "CAPTURE READY" : "CAPTURE LOCKED"}</span></div>
          {snapshotUrl ? <img className="block max-h-[34rem] w-full object-contain" src={snapshotUrl} alt="Latest FREEOS desktop monitoring snapshot" /> : <div className="grid min-h-72 place-items-center px-6 text-center text-sm text-slate-600">No desktop snapshot yet. Use “Capture desktop” or enable the 10-second auto preview.</div>}
          {snapshot && <div className="border-t border-white/[.07] px-4 py-2 font-mono text-[10px] text-slate-600">{snapshot.width}×{snapshot.height} · {new Date(snapshot.timestamp).toLocaleString()}</div>}
        </div>

        <div className="space-y-3">
          <div className="queue-item"><p className="meta mt-0">Computer control</p><p className="m-0 text-sm text-slate-200">{status ? status.controlEnabled ? "Enabled behind approvals" : "Locked by server switch" : "Unknown"}</p></div>
          <div className="queue-item"><p className="meta mt-0">Observation</p><p className="m-0 text-sm text-slate-200">{status ? status.observationAvailable ? "Available" : "Unavailable" : "Unknown"}</p></div>
          <div className="queue-item"><p className="meta mt-0">Resolution</p><p className="m-0 text-sm text-slate-200">{status?.primaryResolution ? `${status.primaryResolution.width} × ${status.primaryResolution.height}` : "Unknown"}</p></div>
          <div className="queue-item"><p className="meta mt-0">Visible windows</p><p className="m-0 text-sm text-slate-200">{status?.visibleWindowCount ?? "Unknown"}</p></div>
          <div className="queue-item"><p className="meta mt-0">Processes</p><p className="m-0 text-sm text-slate-200">{status?.processCount ?? "Unknown"}</p></div>
        </div>
      </div>
    </section>

    <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
      <section className="panel">
        <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Execution trace</p><h3 className="section-title">Recent autonomous/tool actions</h3></div><span className="badge">{monitoredRuns.length} runs</span></div>
        <div className="mt-4 divide-y divide-white/[.06]">
          {monitoredRuns.slice(0, 16).map(run => <article key={run.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
            <div><p className="m-0 font-mono text-xs text-white">#{run.id} · {run.toolKey}</p><p className="mb-0 mt-1 line-clamp-2 text-xs text-slate-500">{run.error || (run.output ? JSON.stringify(run.output) : "No output recorded")}</p></div>
            <div className="text-right"><span className="badge">{run.status}</span><p className="meta mb-0">{formatTime(run.startedAt)} → {formatTime(run.finishedAt)}</p></div>
          </article>)}
          {!monitoredRuns.length && <div className="empty">No computer, browser, coding, agent, scheduler, or automation runs yet.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Why FREEOS stopped</p><h3 className="section-title">Approval / action queue</h3></div><span className="badge">{pendingRequests.length} waiting</span></div>
        <div className="mt-4 space-y-2">
          {pendingRequests.slice(0, 10).map(request => <article className="queue-item" key={request.id}><div className="flex justify-between gap-3"><p className="m-0 text-sm font-semibold text-white">#{request.id} · {request.title}</p><span className="badge">{request.status}</span></div><p className="meta">{request.toolKey} · {request.riskLevel} · requested by {request.requestedBy}</p></article>)}
          {!pendingRequests.length && <div className="empty">No actions are waiting for approval or execution.</div>}
        </div>
      </section>
    </div>

    <section className="panel">
      <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Command audit stream</p><h3 className="section-title">What FREEOS has been doing</h3></div><span className="badge">{activity.length} events</span></div>
      <div className="mt-4 divide-y divide-white/[.06]">
        {activity.slice(0, 20).map(event => <article className="grid gap-2 py-3 sm:grid-cols-[7rem_1fr_auto]" key={`${event.type}-${event.id}-${event.timestamp}`}><span className="badge">{event.type.replaceAll("_", " ")}</span><div><p className="m-0 text-sm font-medium text-slate-200">{event.title}</p><p className="mb-0 mt-1 text-xs leading-5 text-slate-500">{event.message}</p></div><div className="text-right"><p className="meta mt-0">{event.status}</p><time className="font-mono text-[9px] text-slate-700">{new Date(event.timestamp).toLocaleString()}</time></div></article>)}
        {!activity.length && <div className="empty">No command activity recorded yet.</div>}
      </div>
    </section>

    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Manual computer controls</p><h2 className="section-title">Computer Operator</h2></div><span className={`badge ${status?.controlEnabled ? "badge-warn" : "badge-safe"}`}>COMPUTER CONTROL: {status ? status.controlEnabled ? "ENABLED" : "LOCKED" : "UNKNOWN"}</span></div>
      <p className="section-copy">Use this area when you want to prepare a specific computer action yourself. Every control action still needs review, approval, and a separate run.</p>
      {status && !status.controlEnabled && <p className="notice">COMPUTER_CONTROL_ENABLED=false — computer control is locked. Requests can be prepared; the server blocks execution.</p>}
    </section>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel"><p className="eyebrow">Inspect</p><h3 className="section-title">Desktop details</h3><div className="mt-5 flex flex-wrap gap-2">
        <button className="button" disabled={busy} onClick={() => void act(async () => { await refreshTelemetry(true); })}>Refresh status</button>
        <button className="button" disabled={busy} onClick={() => void act(() => observe("windows"))}>List windows</button>
        <button className="button" disabled={busy} onClick={() => void act(() => observe("processes"))}>List processes</button>
      </div>
      {output !== null && <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{JSON.stringify(output, null, 2)}</pre>}</section>

      <section className="panel"><p className="eyebrow">Control</p><h3 className="section-title">Prepare an approval request</h3><p className="section-copy">Foundation targets remain tightly bounded. Input requires the target’s main window to be active; blocked commands and high-risk actions remain blocked.</p>
        <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void act(async () => { const request = await api.createToolRequest({ toolKey, title: actions.find(action => action[0] === toolKey)?.[1] ?? toolKey, args }); setNotice(`Request #${request.id} created. Inspect it below, approve, then run separately.`); setText(""); setQueueVersion(version => version + 1); await refreshTelemetry(); }); }}>
          <label className="block text-xs text-slate-400">Action<select className="field mt-1" value={toolKey} onChange={event => setToolKey(event.target.value)}>{actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {launch ? <><label className="block text-xs text-slate-400">Exact executable path<input className="field mt-1" required value={executable} onChange={event => setExecutable(event.target.value)} /></label><p className="meta">Allowed targets are governed by the Computer Operator policy. Arguments remain empty unless policy explicitly allows them.</p></> : <><label className="block text-xs text-slate-400">Target process ID<input className="field mt-1" required type="number" min="1" step="1" value={pid} onChange={event => setPid(event.target.value)} /></label>{windows.length > 0 && <select aria-label="Choose visible window" className="field" value={pid} onChange={event => setPid(event.target.value)}><option value="">Choose visible window</option>{windows.map((windowInfo, index) => <option key={`${windowInfo.processId}-${index}`} value={windowInfo.processId}>{windowInfo.processName} — {windowInfo.windowTitle} ({windowInfo.processId})</option>)}</select>}</>}
          {mouse && <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">X<input className="field mt-1" required type="number" step="1" value={x} onChange={event => setX(event.target.value)} /></label><label className="text-xs text-slate-400">Y<input className="field mt-1" required type="number" step="1" value={y} onChange={event => setY(event.target.value)} /></label></div>}
          {toolKey === "computer.mouse.click" && <select aria-label="Mouse button" className="field" value={button} onChange={event => setButton(event.target.value)}>{["left", "right", "double"].map(value => <option key={value}>{value}</option>)}</select>}
          {toolKey === "computer.keyboard.type" && <><label className="block text-xs text-slate-400">Text (no passwords or secrets)<textarea className="field mt-1" required maxLength={4000} value={text} onChange={event => setText(event.target.value)} /></label><p className="meta">Printable text only. Sensitive text should never be entered into the approval queue.</p></>}
          {toolKey === "computer.keyboard.press" && <select aria-label="Allowed key" className="field" value={key} onChange={event => setKey(event.target.value)}>{keys.map(value => <option key={value}>{value}</option>)}</select>}
          {toolKey === "computer.keyboard.hotkey" && <select aria-label="Allowed hotkey" className="field" value={hotkey} onChange={event => setHotkey(event.target.value)}>{hotkeys.map(value => <option key={value}>{value}</option>)}</select>}
          <details><summary className="cursor-pointer text-xs text-slate-400">Review exact request arguments</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{JSON.stringify(args, null, 2)}</pre></details>
          <button className="button" disabled={busy}>Create approval request</button>
        </form>
      </section>
    </div>

    <ApprovalHub key={queueVersion} />
  </div>;
}
