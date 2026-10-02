import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ComputerError, assertComputerControlAllowed, assertScreenCaptureAllowed, isComputerControlAllowed, isScreenCaptureAllowed, validateComputerArgs, type ComputerArgs } from "./policy";
export * from "./policy";

export interface WindowInfo { processId: number; processName: string; windowTitle: string; visible: boolean }
export interface ProcessInfo { pid: number; processName: string; mainWindowTitle: string }
export interface Bounds { x: number; y: number; width: number; height: number }
export interface DesktopInfo { monitors: Array<Bounds & {name: string; primary: boolean}>; primaryResolution: {width: number; height: number} | null; virtualBounds: Bounds | null; activeWindow: WindowInfo | null; visibleWindowCount: number | null; processCount: number | null }
export interface ComputerStatus extends DesktopInfo { platform: string; supported: boolean; controlEnabled: boolean; screenCaptureEnabled: boolean; observationAvailable: boolean; health: "healthy" | "unavailable" | "unsupported"; message?: string }
export interface Screenshot { relativePath: string; width: number; height: number; timestamp: string }
export interface WindowTarget { processId: number }
export interface MouseTarget extends WindowTarget { x: number; y: number }
export interface MouseClick extends MouseTarget { button: "left" | "right" | "double" }
export interface TextInput extends WindowTarget { text: string }
export interface KeyInput extends WindowTarget { key: typeof import("./policy").ALLOWED_KEYS[number] }
export interface HotkeyInput extends WindowTarget { hotkey: typeof import("./policy").ALLOWED_HOTKEYS[number] }
export interface ApplicationLaunch { executable: string; args: string[] }

// Typed service entry points use the same runtime validation and centralized gate.
export const focusWindow = (target: WindowTarget) => executeComputerTool("", "computer.window.focus", {...target});
export const moveMouse = (target: MouseTarget) => executeComputerTool("", "computer.mouse.move", {...target});
export const clickMouse = (target: MouseClick) => executeComputerTool("", "computer.mouse.click", {...target});
export const typeText = (input: TextInput) => executeComputerTool("", "computer.keyboard.type", {...input});
export const pressKey = (input: KeyInput) => executeComputerTool("", "computer.keyboard.press", {...input});
export const pressHotkey = (input: HotkeyInput) => executeComputerTool("", "computer.keyboard.hotkey", {...input});
export const launchApplication = (input: ApplicationLaunch) => executeComputerTool("", "computer.app.launch", {...input});

function assertWindows(): void { if (process.platform !== "win32") throw new ComputerError("Computer Operator requires Windows 10/11.", "unavailable"); }
function desktop<T>(operation: string, args: ComputerArgs = {}): Promise<T> {
  assertWindows();
  const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, ["-NoProfile", "-NonInteractive", "-File", resolve(__dirname, "../scripts/desktop.ps1")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let settled = false;
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new ComputerError("Windows operation refused or unavailable. Verify the active target, desktop session, bounds, and application policy.", "unavailable")); } };
    const timer = setTimeout(() => { child.kill(); fail(); }, 20000);
    child.on("error", fail); child.stdin.on("error", fail);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; if (output.length > 2 * 1024 * 1024) { child.kill(); fail(); } });
    child.stderr.resume(); // No raw PowerShell exception or payload logging.
    child.on("close", code => { if (settled) return; clearTimeout(timer); try { const parsed = JSON.parse(output.trim()); if (code !== 0 || parsed.ok !== true) { fail(); return; } settled = true; resolveResult(parsed.result as T); } catch { fail(); } });
    // API data is JSON on stdin; never executable script/command interpolation.
    child.stdin.end(JSON.stringify({operation,args}));
  });
}

export async function getComputerStatus(): Promise<ComputerStatus> {
  const base: ComputerStatus = { platform: process.platform, supported: process.platform === "win32", controlEnabled: isComputerControlAllowed(), screenCaptureEnabled: isScreenCaptureAllowed(), observationAvailable: false, health: process.platform === "win32" ? "unavailable" : "unsupported", monitors: [], primaryResolution: null, virtualBounds: null, activeWindow: null, visibleWindowCount: null, processCount: null };
  if (!base.supported) return base;
  try { return { ...base, ...await desktop<DesktopInfo>("status"), observationAvailable: true, health: "healthy" }; }
  catch { return { ...base, message: "Windows desktop inspection is unavailable in this session." }; }
}
export const listWindows = () => desktop<{windows: WindowInfo[]}>("windows");
export const getActiveWindow = () => desktop<{activeWindow: WindowInfo | null}>("active");
export const listProcesses = () => desktop<{processes: ProcessInfo[]}>("processes");

const screenshotName = /^freeos-screen-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;
async function screenshotDirectory(root: string): Promise<string> {
  const canonicalRoot = await realpath(resolve(root));
  let directory = canonicalRoot;
  for (const part of ["generated", "computer", "screenshots"]) {
    directory = join(directory, part);
    await mkdir(directory).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw new ComputerError("Screenshot directory must not contain links or reparse redirects.", "blocked");
  }
  return directory;
}
// Exact directory + strict FREEOS filename + regular-file checks, never recursive deletion.
export async function pruneScreenshots(root: string, maximum = 20): Promise<void> {
  if (!Number.isInteger(maximum) || maximum < 1) throw new ComputerError("Invalid screenshot retention.", "validation");
  const directory = await screenshotDirectory(root);
  const files = (await readdir(directory, {withFileTypes:true})).filter(file => file.isFile() && screenshotName.test(file.name)).map(file => file.name).sort();
  for (const name of files.slice(0, Math.max(0, files.length - maximum))) {
    if (await screenshotDirectory(root) !== directory) throw new ComputerError("Screenshot directory changed.", "blocked");
    const path = join(directory, name); const info = await lstat(path);
    if (info.isFile() && !info.isSymbolicLink() && info.nlink === 1) await unlink(path);
  }
}
let captureQueue: Promise<unknown> = Promise.resolve();
export function captureScreen(root: string): Promise<Screenshot> {
  const capture = async (): Promise<Screenshot> => {
    assertScreenCaptureAllowed(); assertWindows();
    const directory = await screenshotDirectory(root);
    const timestamp = new Date().toISOString(); const name = `freeos-screen-${Date.now()}-${randomUUID()}.png`;
    assertScreenCaptureAllowed();
    const result = await desktop<{width: number; height: number}>("capture", {path: join(directory, name)});
    await pruneScreenshots(root);
    return {relativePath: `generated/computer/screenshots/${name}`, ...result, timestamp};
  };
  const task = captureQueue.then(capture); captureQueue = task.catch(() => {}); return task;
}

export async function executeComputerTool(root: string, key: string, input: ComputerArgs = {}): Promise<unknown> {
  const args = validateComputerArgs(key, input);
  switch (key) {
    case "computer.status": return getComputerStatus();
    case "computer.windows.list": return listWindows();
    case "computer.window.active": return getActiveWindow();
    case "computer.processes.list": return listProcesses();
    case "computer.screen.capture": return captureScreen(root);
  }
  assertComputerControlAllowed(); assertWindows();
  if (key === "computer.app.launch") {
    return new Promise((resolveResult, reject) => {
      const child = spawn(args.executable as string, args.args as string[], {shell:false,windowsHide:true,stdio:"ignore"});
      child.once("spawn", () => { child.unref(); resolveResult({launched:true,processId:child.pid,executable:args.executable,args:args.args}); });
      child.once("error", () => reject(new ComputerError("Allowed application could not be launched.", "unavailable")));
    });
  }
  const operations: Record<string,string> = {"computer.window.focus":"focus","computer.mouse.move":"move","computer.mouse.click":"click","computer.keyboard.type":"type","computer.keyboard.press":"press","computer.keyboard.hotkey":"hotkey"};
  if (!operations[key]) throw new ComputerError("Computer action is not implemented.", "blocked");
  return desktop(operations[key],args);
}
