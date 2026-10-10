import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, extname, resolve, sep } from "node:path";

export type OperatorKey =
  | "blender"
  | "premiere"
  | "after-effects"
  | "photoshop"
  | "lightroom"
  | "unity"
  | "unreal"
  | "comfyui"
  | "obs"
  | "vscode";

export type OperatorCapability = "ui-control" | "launch" | "native-plan" | "environment-discovery";

export interface OperatorProfile {
  key: OperatorKey;
  name: string;
  envVar: string;
  processNames: string[];
  executableNames: string[];
  capabilities: OperatorCapability[];
  notes: string;
}

export interface OperatorStatus extends OperatorProfile {
  configured: boolean;
  executablePath: string | null;
  executableExists: boolean;
  ready: boolean;
}

export interface BlenderEnvironmentDetails {
  blenderVersion: string;
  pythonVersion: string;
  enabledAddonModules: string[];
  addons: Array<{ module: string; name: string; version: string; category: string; enabled: boolean }>;
  capabilitySignals: string[];
}

export interface OperatorEnvironmentInventory {
  operator: OperatorStatus;
  availableOperators: Array<{ key: OperatorKey; name: string; ready: boolean; capabilities: OperatorCapability[] }>;
  deepInspection: "blender" | "status-only";
  blender?: BlenderEnvironmentDetails;
  inspectedAt: string;
}

export interface BlenderOperatorResult {
  operatorKey: "blender";
  planPath: string;
  exitCode: 0;
  manifest: Record<string, unknown>;
  stdout: string;
}

export class OperatorError extends Error {
  constructor(message: string, readonly code: "validation" | "blocked" | "unavailable") {
    super(message);
    this.name = "OperatorError";
  }
}

export const OPERATOR_PROFILES: OperatorProfile[] = [
  { key: "blender", name: "Blender Operator", envVar: "FREEOS_OPERATOR_BLENDER_EXE", processNames: ["blender"], executableNames: ["blender.exe"], capabilities: ["ui-control", "launch", "native-plan", "environment-discovery"], notes: "Native plan execution uses a fixed FREEOS Blender driver rather than arbitrary Python. Environment discovery can inventory enabled/installed Blender addons for quality preflight." },
  { key: "premiere", name: "Premiere Pro Operator", envVar: "FREEOS_OPERATOR_PREMIERE_EXE", processNames: ["Adobe Premiere Pro"], executableNames: ["Adobe Premiere Pro.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI production operator; native project automation can be added behind a dedicated adapter." },
  { key: "after-effects", name: "After Effects Operator", envVar: "FREEOS_OPERATOR_AFTER_EFFECTS_EXE", processNames: ["AfterFX"], executableNames: ["AfterFX.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI production operator; native render adapters remain separately governed." },
  { key: "photoshop", name: "Photoshop Operator", envVar: "FREEOS_OPERATOR_PHOTOSHOP_EXE", processNames: ["Photoshop"], executableNames: ["Photoshop.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI production operator." },
  { key: "lightroom", name: "Lightroom Operator", envVar: "FREEOS_OPERATOR_LIGHTROOM_EXE", processNames: ["Lightroom", "LightroomClassic"], executableNames: ["Lightroom.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI production operator." },
  { key: "unity", name: "Unity Operator", envVar: "FREEOS_OPERATOR_UNITY_EXE", processNames: ["Unity"], executableNames: ["Unity.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI production operator; batch-mode project adapters can be added as fixed operations." },
  { key: "unreal", name: "Unreal Engine Operator", envVar: "FREEOS_OPERATOR_UNREAL_EXE", processNames: ["UnrealEditor"], executableNames: ["UnrealEditor.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI production operator; commandlet adapters can be added as fixed operations." },
  { key: "comfyui", name: "ComfyUI Operator", envVar: "FREEOS_OPERATOR_COMFYUI_EXE", processNames: ["ComfyUI"], executableNames: ["ComfyUI.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "Local GUI operator. HTTP workflow execution should use a dedicated local adapter rather than arbitrary shell commands." },
  { key: "obs", name: "OBS Studio Operator", envVar: "FREEOS_OPERATOR_OBS_EXE", processNames: ["obs64", "obs32"], executableNames: ["obs64.exe", "obs32.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI production operator; streaming/record controls should use a dedicated OBS adapter when enabled." },
  { key: "vscode", name: "VS Code Operator", envVar: "FREEOS_OPERATOR_VSCODE_EXE", processNames: ["Code"], executableNames: ["Code.exe"], capabilities: ["ui-control", "launch", "environment-discovery"], notes: "GUI companion to the existing governed Coding Workspace." },
];

const blockedExecutableNames = new Set([
  "cmd.exe", "powershell.exe", "pwsh.exe", "wt.exe", "regedit.exe", "reg.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe", "explorer.exe",
]);

function profile(key: string): OperatorProfile {
  const found = OPERATOR_PROFILES.find(item => item.key === key);
  if (!found) throw new OperatorError(`Unknown operator: ${key}.`, "validation");
  return found;
}

function configuredPath(item: OperatorProfile): string | null {
  const value = process.env[item.envVar]?.trim();
  if (!value) return null;
  const full = resolve(value);
  const file = basename(full);
  if (blockedExecutableNames.has(file.toLowerCase())) throw new OperatorError(`${item.name} cannot be mapped to a command shell, file manager, or script host.`, "blocked");
  if (!item.executableNames.some(name => name.toLowerCase() === file.toLowerCase())) throw new OperatorError(`${item.name} must point to one of: ${item.executableNames.join(", ")}.`, "blocked");
  return full;
}

export function listOperators(): OperatorStatus[] {
  return OPERATOR_PROFILES.map(item => getOperatorStatus(item.key));
}

export function getOperatorStatus(key: OperatorKey): OperatorStatus {
  const item = profile(key);
  const executablePath = configuredPath(item);
  const executableExists = !!executablePath && existsSync(executablePath) && statSync(executablePath).isFile();
  return { ...item, configured: !!executablePath, executablePath, executableExists, ready: executableExists };
}

export function configuredOperatorExecutables(): string[] {
  return OPERATOR_PROFILES.flatMap(item => {
    try {
      const path = configuredPath(item);
      return path ? [path] : [];
    } catch {
      return [];
    }
  });
}

function requireExecutable(key: OperatorKey): string {
  const status = getOperatorStatus(key);
  if (!status.executablePath) throw new OperatorError(`${status.name} is not configured. Set ${status.envVar} to the exact executable path.`, "unavailable");
  if (!status.executableExists) throw new OperatorError(`${status.name} executable was not found at the configured path.`, "unavailable");
  return status.executablePath;
}

export function launchOperator(key: OperatorKey): Promise<{ launched: true; operatorKey: OperatorKey; processId: number | undefined }> {
  const executable = requireExecutable(key);
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [], { shell: false, windowsHide: false, detached: true, stdio: "ignore" });
    child.once("spawn", () => {
      child.unref();
      resolveResult({ launched: true, operatorKey: key, processId: child.pid });
    });
    child.once("error", () => reject(new OperatorError(`${profile(key).name} could not be launched.`, "unavailable")));
  });
}

function inside(root: string, candidate: string): string {
  const base = resolve(root);
  const full = resolve(candidate);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  if (full.toLowerCase() !== base.toLowerCase() && !full.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new OperatorError("Operator path is outside the allowed FREEOS workspace.", "blocked");
  }
  return full;
}

function diagnosticTail(stdout: string, stderr: string): string {
  const combined = `${stderr}\n${stdout}`.trim();
  return combined.slice(-2400).replace(/[\r\n]+/g, " | ");
}

function parseMarker<T>(stdout: string, marker: string): T {
  const line = stdout.split(/\r?\n/).reverse().find(item => item.startsWith(marker));
  if (!line) throw new OperatorError(`Operator inspection completed without ${marker} evidence.`, "unavailable");
  try { return JSON.parse(line.slice(marker.length)) as T; }
  catch { throw new OperatorError("Operator inspection returned invalid JSON evidence.", "unavailable"); }
}

async function inspectBlenderEnvironment(): Promise<BlenderEnvironmentDetails> {
  const executable = requireExecutable("blender");
  const script = resolve(__dirname, "..", "scripts", "blender_inventory.py");
  if (!existsSync(script)) throw new OperatorError("FREEOS Blender inventory script is missing from operator-core.", "unavailable");
  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, ["--background", "--python", script], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new OperatorError("Blender environment inspection timed out.", "unavailable")); }, 90_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { if (stdout.length < 1024 * 1024) stdout += chunk; });
    child.stderr.on("data", chunk => { if (stderr.length < 256 * 1024) stderr += chunk; });
    child.once("error", () => { clearTimeout(timeout); reject(new OperatorError("Blender could not start for environment inspection.", "unavailable")); });
    child.once("close", code => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new OperatorError(`Blender environment inspection failed.${diagnosticTail(stdout, stderr) ? ` ${diagnosticTail(stdout, stderr)}` : ""}`, "unavailable")); return; }
      try { resolveResult(parseMarker<BlenderEnvironmentDetails>(stdout, "FREEOS_OPERATOR_INVENTORY=")); }
      catch (error) { reject(error); }
    });
  });
}

export async function inspectOperatorEnvironment(key: OperatorKey): Promise<OperatorEnvironmentInventory> {
  const operator = getOperatorStatus(key);
  const availableOperators = listOperators().map(item => ({ key: item.key, name: item.name, ready: item.ready, capabilities: item.capabilities }));
  const inspectedAt = new Date().toISOString();
  if (key === "blender" && operator.ready) {
    return { operator, availableOperators, deepInspection: "blender", blender: await inspectBlenderEnvironment(), inspectedAt };
  }
  return { operator, availableOperators, deepInspection: "status-only", inspectedAt };
}

export async function runBlenderPlan(rootDir: string, planPath: string): Promise<BlenderOperatorResult> {
  const executable = requireExecutable("blender");
  const plansRoot = resolve(rootDir, "generated", "operators", "blender", "plans");
  const fullPlan = inside(plansRoot, planPath);
  if (extname(fullPlan).toLowerCase() !== ".json" || !existsSync(fullPlan) || !statSync(fullPlan).isFile()) {
    throw new OperatorError("Blender plan must be an existing .json file inside generated/operators/blender/plans.", "validation");
  }
  const plan = JSON.parse(readFileSync(fullPlan, "utf8")) as Record<string, unknown>;
  const jobKey = typeof plan.jobKey === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(plan.jobKey) ? plan.jobKey : null;
  if (!jobKey) throw new OperatorError("Blender plan has an invalid jobKey.", "validation");
  const manifestPath = inside(resolve(rootDir, "generated", "operators", "blender", "jobs"), resolve(rootDir, "generated", "operators", "blender", "jobs", jobKey, "manifest.json"));
  const driver = resolve(__dirname, "..", "scripts", "blender_driver.py");
  if (!existsSync(driver)) throw new OperatorError("FREEOS Blender driver is missing from operator-core.", "unavailable");

  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, ["--background", "--python", driver, "--", "--root", resolve(rootDir), "--plan", fullPlan], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new OperatorError("Blender plan exceeded the 20 minute operator timeout.", "unavailable"));
    }, 20 * 60_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { if (stdout.length < 1024 * 1024) stdout += chunk; });
    child.stderr.on("data", chunk => { if (stderr.length < 256 * 1024) stderr += chunk; });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new OperatorError("Blender could not start the governed plan runner.", "unavailable"));
    });
    child.once("close", code => {
      clearTimeout(timeout);
      const tail = diagnosticTail(stdout, stderr);
      if (code !== 0) {
        reject(new OperatorError(`Blender plan failed with exit code ${code ?? "unknown"}.${tail ? ` ${tail}` : ""}`.trim(), "unavailable"));
        return;
      }
      if (!stdout.includes("FREEOS_OPERATOR_RESULT=")) {
        reject(new OperatorError(`Blender exited without FREEOS completion evidence.${tail ? ` ${tail}` : ""}`.trim(), "unavailable"));
        return;
      }
      if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
        reject(new OperatorError(`Blender reported completion but the manifest was not created for ${jobKey}.`, "unavailable"));
        return;
      }
      let manifest: Record<string, unknown>;
      try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>; }
      catch { reject(new OperatorError("Blender manifest could not be parsed.", "unavailable")); return; }
      if (manifest.ok !== true || typeof manifest.blendFile !== "string") {
        reject(new OperatorError("Blender manifest did not verify a saved .blend deliverable.", "unavailable"));
        return;
      }
      resolveResult({ operatorKey: "blender", planPath: fullPlan, exitCode: 0, manifest, stdout: stdout.slice(-4000).trim() });
    });
  });
}