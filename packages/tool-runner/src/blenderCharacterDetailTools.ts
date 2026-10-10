import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { getOperatorStatus } from "@freeos/operator-core";
import { recordCapabilityVerification } from "./capabilityVerification";
import { ToolRunnerError } from "./tool.types";

export interface MpfbDetailProfile {
  noseVolume: number;
  noseWidth: number;
  chinProminence: number;
  chinHeight: number;
  cupidBow: number;
  cupidBowWidth: number;
}

export interface MpfbDetailResult {
  ok: true;
  jobKey: string;
  adapter: string;
  operator: string;
  detailTargetsVerified: true;
  renderVerified: true;
  requestedControls: MpfbDetailProfile;
  appliedTargets: Array<{ control: string; value: number; target: string }>;
  activeDetailShapeKeys: Array<{ name: string; value: number }>;
  blendFile: string;
  renderFile: string;
  basemesh: string;
  vertexCount: number;
  polygonCount: number;
  shapeKeyCount: number;
  materialCount: number;
  diagnosticMaterial?: string;
  diagnosticMaterialAppliedCount?: number;
}

function inside(rootDir: string, candidate: string): string {
  const root = resolve(rootDir);
  const full = resolve(candidate);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (full.toLowerCase() !== root.toLowerCase() && !full.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new ToolRunnerError("MPFB detail adapter path escaped the FREEOS workspace.", "blocked");
  }
  return full;
}

function safeJobKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value.trim())) {
    throw new ToolRunnerError("jobKey must contain only letters, numbers, dot, underscore, or dash and be at most 80 characters.", "validation");
  }
  return value.trim();
}

function bounded(value: unknown, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < -1 || parsed > 1) {
    throw new ToolRunnerError(`${name} must be a number from -1 to 1.`, "validation");
  }
  return parsed;
}

export function normalizeMpfbDetailProfile(value: unknown): MpfbDetailProfile {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    noseVolume: bounded(input.noseVolume, 0.28, "noseVolume"),
    noseWidth: bounded(input.noseWidth, 0.18, "noseWidth"),
    chinProminence: bounded(input.chinProminence, 0.30, "chinProminence"),
    chinHeight: bounded(input.chinHeight, 0.12, "chinHeight"),
    cupidBow: bounded(input.cupidBow, 0.16, "cupidBow"),
    cupidBowWidth: bounded(input.cupidBowWidth, 0.12, "cupidBowWidth"),
  };
}

function tail(stdout: string, stderr: string): string {
  return `${stderr}\n${stdout}`.trim().slice(-3000).replace(/[\r\n]+/g, " | ");
}

function parseMarker(stdout: string): MpfbDetailResult {
  const prefix = "FREEOS_MPFB_DETAIL_RESULT=";
  const line = stdout.split(/\r?\n/).reverse().find(item => item.startsWith(prefix));
  if (!line) throw new ToolRunnerError("Blender exited without MPFB detail result evidence.", "blocked");
  try {
    const parsed = JSON.parse(line.slice(prefix.length)) as MpfbDetailResult;
    if (!parsed?.ok || !parsed.detailTargetsVerified || !parsed.renderVerified || !Array.isArray(parsed.activeDetailShapeKeys) || parsed.activeDetailShapeKeys.length < 1) {
      throw new Error("verification flags missing");
    }
    return parsed;
  } catch {
    throw new ToolRunnerError("MPFB detail adapter returned invalid verification evidence.", "blocked");
  }
}

function readManifest(path: string): MpfbDetailResult {
  if (!existsSync(path)) throw new ToolRunnerError("MPFB detail adapter did not create its verification manifest.", "blocked");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MpfbDetailResult;
    if (!parsed?.ok || !parsed.detailTargetsVerified || !parsed.renderVerified || !Array.isArray(parsed.activeDetailShapeKeys) || parsed.activeDetailShapeKeys.length < 1) {
      throw new Error("verification flags missing");
    }
    return parsed;
  } catch {
    throw new ToolRunnerError("MPFB detail manifest could not be parsed or did not verify target effects.", "blocked");
  }
}

export async function runMpfbDetailTest(rootDir: string, rawJobKey: unknown, rawProfile: unknown): Promise<MpfbDetailResult & { stdoutTail: string }> {
  const jobKey = safeJobKey(rawJobKey);
  const profile = normalizeMpfbDetailProfile(rawProfile);
  const blender = getOperatorStatus("blender");
  if (!blender.ready || !blender.executablePath) throw new ToolRunnerError("Blender Operator is not ready.", "blocked");

  const script = inside(rootDir, resolve(rootDir, "packages", "operator-core", "scripts", "blender_mpfb_detail.py"));
  if (!existsSync(script)) throw new ToolRunnerError("FREEOS MPFB detail driver is missing.", "blocked");
  const manifestPath = inside(rootDir, resolve(rootDir, "generated", "operators", "blender", "mpfb-detail", jobKey, "manifest.json"));

  const args = [
    "--background", "--python", script, "--", "--root", resolve(rootDir), "--job-key", jobKey,
    "--nose-volume", String(profile.noseVolume),
    "--nose-width", String(profile.noseWidth),
    "--chin-prominence", String(profile.chinProminence),
    "--chin-height", String(profile.chinHeight),
    "--cupid-bow", String(profile.cupidBow),
    "--cupid-bow-width", String(profile.cupidBowWidth),
  ];

  return await new Promise((resolveResult, reject) => {
    const child = spawn(blender.executablePath!, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error, value?: MpfbDetailResult & { stdoutTail: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveResult(value!);
    };

    const verifyEvidence = (): MpfbDetailResult => {
      const marker = parseMarker(stdout);
      const manifest = readManifest(manifestPath);
      if (manifest.jobKey !== marker.jobKey || manifest.blendFile !== marker.blendFile || manifest.renderFile !== marker.renderFile) {
        throw new ToolRunnerError("MPFB detail stdout and manifest evidence do not match.", "blocked");
      }
      recordCapabilityVerification({
        capabilityKey: "blender.mpfb.detail-targets",
        operatorKey: "blender",
        toolName: "MPFB / MakeHuman",
        verificationKind: manifest.adapter,
        evidence: manifest as unknown as Record<string, unknown>,
      });
      return manifest;
    };

    const tryFinish = () => {
      if (settled || !stdout.includes("FREEOS_MPFB_DETAIL_RESULT=")) return;
      try {
        const manifest = verifyEvidence();
        finish(undefined, { ...manifest, stdoutTail: tail(stdout, stderr) });
        if (!child.killed) child.kill();
      } catch { /* evidence may still be mid-write */ }
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(new ToolRunnerError("MPFB detail verification timed out.", "blocked"));
    }, 180_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { if (stdout.length < 2 * 1024 * 1024) stdout += chunk; tryFinish(); });
    child.stderr.on("data", chunk => { if (stderr.length < 512 * 1024) stderr += chunk; });
    child.once("error", () => finish(new ToolRunnerError("Blender could not start for MPFB detail verification.", "blocked")));
    child.once("close", code => {
      if (settled) return;
      try {
        if (code !== 0) throw new ToolRunnerError(`MPFB detail verification failed.${tail(stdout, stderr) ? ` ${tail(stdout, stderr)}` : ""}`, "blocked");
        const manifest = verifyEvidence();
        finish(undefined, { ...manifest, stdoutTail: tail(stdout, stderr) });
      } catch (error) {
        finish(error instanceof Error ? error : new ToolRunnerError("MPFB detail verification failed.", "blocked"));
      }
    });
  });
}
