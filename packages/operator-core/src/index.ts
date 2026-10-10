import { existsSync, statSync } from "node:fs";
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

export type OperatorCapability = "ui-control" | "launch" | "native-plan";

export interface OperatorProfile {
  key: OperatorKey;
  name: string;
  envVar: string;
  processNames: string[];
  capabilities: OperatorCapability[];
  notes: string;
}

export interface OperatorStatus extends OperatorProfile {
  configured: boolean;
  executablePath: string | null;
  executableExists: boolean;
  ready: boolean;
}

export class OperatorError extends Error {
  constructor(message: string, readonly code: "validation" | "blocked" | "unavailable") {
    super(message);
    this.name = "OperatorError";
  }
}

export const OPERATOR_PROFILES: OperatorProfile[] = [
  { key: "blender", name: "Blender Operator", envVar: "FREEOS_OPERATOR_BLENDER_EXE", processNames: ["blender"], capabilities: ["ui-control", "launch", "native-plan"], notes: "Native plan execution uses a fixed FREEOS Blender driver rather than arbitrary Python." },
  { key: "premiere", name: "Premiere Pro Operator", envVar: "FREEOS_OPERATOR_PREMIERE_EXE", processNames: ["Adobe Premiere Pro"], capabilities: ["ui-control", "launch"], notes: "GUI production operator; native project automation can be added behind a dedicated adapter." },
  { key: "after-effects", name: "After Effects Operator", envVar: "FREEOS_OPERATOR_AFTER_EFFECTS_EXE", processNames: ["AfterFX"], capabilities: ["ui-control", "launch"], notes: "GUI production operator; native render adapters remain separately governed." },
  { key: "photoshop", name: "Photoshop Operator", envVar: "FREEOS_OPERATOR_PHOTOSHOP_EXE", processNames: ["Photoshop"], capabilities: ["ui-control", "launch"], notes: "GUI production operator." },
  { key: "lightroom", name: "Lightroom Operator", envVar: "FREEOS_OPERATOR_LIGHTROOM_EXE", processNames: ["Lightroom", "LightroomClassic"], capabilities: ["ui-control", "launch"], notes: "GUI production operator." },
  { key: "unity", name: "Unity Operator", envVar: "FREEOS_OPERATOR_UNITY_EXE", processNames: ["Unity"], capabilities: ["ui-control", "launch"], notes: "GUI production operator; batch-mode project adapters can be added as fixed operations." },
  { key: "unreal", name: "Unreal Engine Operator", envVar: "FREEOS_OPERATOR_UNREAL_EXE", processNames: ["UnrealEditor"], capabilities: ["ui-control", "launch"], notes: "GUI production operator; commandlet adapters can be added as fixed operations." },
  { key: "comfyui", name: "ComfyUI Operator", envVar: "FREEOS_OPERATOR_COMFYUI_EXE", processNames: ["ComfyUI"], capabilities: ["ui-control", "launch"], notes: "Local GUI operator. HTTP workflow execution should use a dedicated local adapter rather than arbitrary shell commands." },
  { key: "obs", name: "OBS Studio Operator", envVar: "FREEOS_OPERATOR_OBS_EXE", processNames: ["obs64", "obs32"], capabilities: ["ui-control", "launch"], notes: "GUI production operator; streaming/record controls should use a dedicated OBS adapter when enabled." },
  { key: "vscode", name: "VS Code Operator", envVar: "FREEOS_OPERATOR_VSCODE_EXE", processNames: ["Code"], capabilities: ["ui-control", "launch"], notes: "GUI companion to the existing governed Coding Workspace." },
];

const blockedExecutableNames = new Set([
  "cmd.exe", "powershell.exe", "pwsh.exe", "wt.exe", "regedit.exe", "reg.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe",
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
  if (blockedExecutableNames.has(basename(full).toLowerCase())) throw new OperatorError(`${item.name} cannot be mapped to a command shell or script host.`, "blocked");
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

export async function runBlenderPlan(rootDir: string, planPath: string): Promise<{ operatorKey: "blender"; planPath: string; exitCode: 0; stdout: string }> {
  const executable = requireExecutable("blender");
  const plansRoot = resolve(rootDir, "generated", "operators", "blender", "plans");
  const fullPlan = inside(plansRoot, planPath);
  if (extname(fullPlan).toLowerCase() !== ".json" || !existsSync(fullPlan) || !statSync(fullPlan).isFile()) {
    throw new OperatorError("Blender plan must be an existing .json file inside generated/operators/blender/plans.", "validation");
  }
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
      if (code !== 0) {
        reject(new OperatorError(`Blender plan failed with exit code ${code ?? "unknown"}. ${stderr.slice(-1200)}`.trim(), "unavailable"));
        return;
      }
      resolveResult({ operatorKey: "blender", planPath: fullPlan, exitCode: 0, stdout: stdout.slice(-4000).trim() });
    });
  });
}
