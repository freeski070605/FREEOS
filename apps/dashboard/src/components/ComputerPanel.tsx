import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ApprovalHub } from "./ApprovalHub";

interface WindowInfo { processId: number; processName: string; windowTitle: string; visible: boolean }
interface ComputerStatus {
  platform: string; supported: boolean; health: string; controlEnabled: boolean; screenCaptureEnabled: boolean; observationAvailable: boolean;
  primaryResolution: {width: number; height: number} | null; activeWindow: WindowInfo | null; visibleWindowCount: number | null; processCount: number | null;
}
const actions = [
  ["computer.window.focus", "Focus window"], ["computer.app.launch", "Launch app"], ["computer.mouse.move", "Move mouse"], ["computer.mouse.click", "Click mouse"],
  ["computer.keyboard.type", "Type text"], ["computer.keyboard.press", "Press key"], ["computer.keyboard.hotkey", "Hotkey"],
];
const keys = ["Tab", "Escape", "Left", "Right", "Up", "Down", "Home", "End", "PageUp", "PageDown", "Backspace", "Space"];
const hotkeys = ["CTRL+A", "CTRL+C", "CTRL+Z", "CTRL+Y", "CTRL+F", "SHIFT+TAB"];

export function ComputerPanel() {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [toolKey, setToolKey] = useState(actions[0][0]);
  const [pid, setPid] = useState(""); const [x, setX] = useState("0"); const [y, setY] = useState("0");
  const [button, setButton] = useState("left"); const [text, setText] = useState(""); const [key, setKey] = useState("Tab"); const [hotkey, setHotkey] = useState("CTRL+A");
  const [executable, setExecutable] = useState("C:\\Windows\\System32\\notepad.exe");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [output, setOutput] = useState<unknown>(null); const [queueVersion, setQueueVersion] = useState(0);
  const refresh = async () => { try { const run = await api.runReadonlyTool("computer.status"); setStatus(run.output as ComputerStatus); } catch (error) { setStatus(null); throw error; } };
  async function act(action: () => Promise<void>) { setBusy(true); setNotice(""); try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Computer operation unavailable."); } finally { setBusy(false); } }
  useEffect(() => { void act(refresh); }, []);
  const launch = toolKey === "computer.app.launch";
  const mouse = toolKey.startsWith("computer.mouse.");
  const args: Record<string, unknown> = launch ? {executable, args: []} : {processId: Number(pid)};
  if (mouse) Object.assign(args, {x:Number(x), y:Number(y)});
  if (toolKey === "computer.mouse.click") args.button=button;
  if (toolKey === "computer.keyboard.type") args.text=text;
  if (toolKey === "computer.keyboard.press") args.key=key;
  if (toolKey === "computer.keyboard.hotkey") args.hotkey=hotkey;
  async function observe(tool: string) {
    const run = await api.runReadonlyTool(tool); setOutput(run.output);
    if (tool === "computer.windows.list") setWindows((run.output as {windows: WindowInfo[]}).windows);
  }
  return <div className="space-y-4">
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Local Windows capability</p><h2 className="section-title">Computer Operator</h2></div><span className={`badge ${status?.controlEnabled ? "badge-warn" : "badge-safe"}`}>COMPUTER CONTROL: {status ? status.controlEnabled ? "ENABLED" : "LOCKED" : "UNKNOWN"}</span></div>
      <p className="section-copy">Observe your PC locally. Every control action needs review, approval, and a separate run.</p>
      {status && !status.controlEnabled && <p className="notice">COMPUTER_CONTROL_ENABLED=false — computer control is locked. Requests can be prepared; the server blocks execution.</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Windows", status ? `${status.platform} / ${status.health}` : "Unavailable"],
        ["Screen capture", status ? status.screenCaptureEnabled ? "Enabled" : "Locked" : "Unknown"],
        ["Primary resolution", status?.primaryResolution ? `${status.primaryResolution.width} × ${status.primaryResolution.height}` : "Unavailable"],
        ["Observation", status ? status.observationAvailable ? "Available" : "Unavailable" : "Unknown"],
        ["Active application", status?.activeWindow?.processName ?? "Unavailable"], ["Active window", status?.activeWindow?.windowTitle ?? "Unavailable"],
        ["Visible windows", status?.visibleWindowCount ?? "Unavailable"], ["Processes", status?.processCount ?? "Unavailable"],
      ].map(([label,value]) => <div key={label} className="queue-item min-w-0"><p className="meta mt-0">{label}</p><p className="m-0 break-words text-sm text-slate-200">{value}</p></div>)}</div>
    </section>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel"><p className="eyebrow">Observe</p><h3 className="section-title">Desktop inspection</h3><div className="mt-5 flex flex-wrap gap-2">
        <button className="button" disabled={busy} onClick={() => void act(refresh)}>Refresh status</button>
        <button className="button" disabled={busy} onClick={() => void act(() => observe("computer.windows.list"))}>List windows</button>
        <button className="button" disabled={busy} onClick={() => void act(() => observe("computer.processes.list"))}>List processes</button>
        <button className="button" disabled={busy || !status?.screenCaptureEnabled} onClick={() => void act(() => observe("computer.screen.capture"))}>Capture screenshot</button>
      </div><p className="section-copy">Screenshots stay in generated/computer/screenshots. Maximum 20 FREEOS captures. Capture has its own opt-in switch.</p>
      {output !== null && <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{JSON.stringify(output,null,2)}</pre>}</section>
      <section className="panel"><p className="eyebrow">Control</p><h3 className="section-title">Prepare an approval request</h3><p className="section-copy">Foundation targets: Notepad, Calculator, and Paint in trusted Windows locations. Input requires the target’s main window to be active. Shells, scripts, paste, Enter, and system hotkeys are blocked.</p>
        <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void act(async () => { const request = await api.createToolRequest({toolKey,title:actions.find(a=>a[0]===toolKey)![1],args}); setNotice(`Request #${request.id} created. Inspect it below, approve, then run separately.`); setText(""); setQueueVersion(v=>v+1); }); }}>
          <label className="block text-xs text-slate-400">Action<select className="field mt-1" value={toolKey} onChange={event=>setToolKey(event.target.value)}>{actions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          {launch ? <><label className="block text-xs text-slate-400">Exact executable path<input className="field mt-1" required value={executable} onChange={event=>setExecutable(event.target.value)}/></label><p className="meta">Allowed: System32 notepad.exe, calc.exe, mspaint.exe. Arguments: [] (empty only).</p></> : <><label className="block text-xs text-slate-400">Target process ID<input className="field mt-1" required type="number" min="1" step="1" value={pid} onChange={event=>setPid(event.target.value)}/></label>{windows.length > 0 && <select aria-label="Choose visible window" className="field" value={pid} onChange={event=>setPid(event.target.value)}><option value="">Choose visible window</option>{windows.map((w,i)=><option key={`${w.processId}-${i}`} value={w.processId}>{w.processName} — {w.windowTitle} ({w.processId})</option>)}</select>}</>}
          {mouse && <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">X<input className="field mt-1" required type="number" step="1" value={x} onChange={event=>setX(event.target.value)}/></label><label className="text-xs text-slate-400">Y<input className="field mt-1" required type="number" step="1" value={y} onChange={event=>setY(event.target.value)}/></label></div>}
          {toolKey === "computer.mouse.click" && <select aria-label="Mouse button" className="field" value={button} onChange={event=>setButton(event.target.value)}>{["left","right","double"].map(v=><option key={v}>{v}</option>)}</select>}
          {toolKey === "computer.keyboard.type" && <><label className="block text-xs text-slate-400">Text (no passwords or secrets)<textarea className="field mt-1" required maxLength={4000} value={text} onChange={event=>setText(event.target.value)}/></label><p className="meta">Printable text only, up to 4000 characters. Text stays in API memory for review and expires on restart.</p></>}
          {toolKey === "computer.keyboard.press" && <select aria-label="Allowed key" className="field" value={key} onChange={event=>setKey(event.target.value)}>{keys.map(v=><option key={v}>{v}</option>)}</select>}
          {toolKey === "computer.keyboard.hotkey" && <select aria-label="Allowed hotkey" className="field" value={hotkey} onChange={event=>setHotkey(event.target.value)}>{hotkeys.map(v=><option key={v}>{v}</option>)}</select>}
          <details><summary className="cursor-pointer text-xs text-slate-400">Review exact request arguments</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{JSON.stringify(args,null,2)}</pre></details>
          <button className="button" disabled={busy}>Create approval request</button>
        </form>
      </section>
    </div>
    <ApprovalHub key={queueVersion}/>
  </div>;
}
