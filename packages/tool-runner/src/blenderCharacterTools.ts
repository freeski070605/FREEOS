import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { getOperatorStatus } from "@freeos/operator-core";
import { ToolRunnerError } from "./tool.types";

export interface MpfbSmokeResult {
  ok: true;
  jobKey: string;
  adapter: string;
  operator: string;
  baseHumanVerified: true;
  renderVerified: true;
  blendFile: string;
  renderFile: string;
  basemesh: string;
  vertexCount: number;
  polygonCount: number;
  shapeKeyCount: number;
  materialCount: number;
  diagnosticMaterial?: string;
  diagnosticMaterialAppliedCount?: number;
  createdObjectCount: number;
}

function inside(rootDir: string, candidate: string): string {
  const root = resolve(rootDir);
  const full = resolve(candidate);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (full.toLowerCase() !== root.toLowerCase() && !full.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new ToolRunnerError("MPFB smoke-test path escaped the FREEOS workspace.", "blocked");
  }
  return full;
}

function safeJobKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value.trim())) {
    throw new ToolRunnerError("jobKey must contain only letters, numbers, dot, underscore, or dash and be at most 80 characters.", "validation");
  }
  return value.trim();
}

function parseMarker(stdout: string): MpfbSmokeResult {
  const prefix = "FREEOS_MPFB_SMOKE_RESULT=";
  const line = stdout.split(/\r?\n/).reverse().find(item => item.startsWith(prefix));
  if (!line) throw new ToolRunnerError("Blender exited without MPFB smoke-test result evidence.", "blocked");
  try {
    const parsed = JSON.parse(line.slice(prefix.length)) as MpfbSmokeResult;
    if (!parsed?.ok || !parsed.baseHumanVerified || !parsed.renderVerified) {
      throw new Error("verification flags missing");
    }
    return parsed;
  } catch {
    throw new ToolRunnerError("MPFB smoke-test returned invalid verification evidence.", "blocked");
  }
}

function readVerifiedManifest(expectedManifest: string, marker: MpfbSmokeResult): MpfbSmokeResult {
  if (!existsSync(expectedManifest)) throw new ToolRunnerError("MPFB smoke test did not create its verification manifest.", "blocked");
  let manifest: MpfbSmokeResult;
  try { manifest = JSON.parse(readFileSync(expectedManifest, "utf8")) as MpfbSmokeResult; }
  catch { throw new ToolRunnerError("MPFB smoke-test manifest could not be parsed.", "blocked"); }
  if (!manifest.ok || !manifest.baseHumanVerified || !manifest.renderVerified) {
    throw new ToolRunnerError("MPFB smoke-test manifest did not verify the base human and render.", "blocked");
  }
  if (manifest.jobKey !== marker.jobKey || manifest.blendFile !== marker.blendFile || manifest.renderFile !== marker.renderFile) {
    throw new ToolRunnerError("MPFB smoke-test stdout and manifest evidence do not match.", "blocked");
  }
  return manifest;
}

function tail(stdout: string, stderr: string): string {
  return `${stderr}\n${stdout}`.trim().slice(-3000).replace(/[\r\n]+/g, " | ");
}

export async function runMpfbBaseSmokeTest(rootDir: string, rawJobKey: unknown): Promise<MpfbSmokeResult & { stdoutTail: string }> {
  const jobKey = safeJobKey(rawJobKey);
  const blender = getOperatorStatus("blender");
  if (!blender.ready || !blender.executablePath) throw new ToolRunnerError("Blender Operator is not ready.", "blocked");

  const script = inside(rootDir, resolve(rootDir, "packages", "operator-core", "scripts", "blender_mpfb_smoke.py"));
  if (!existsSync(script)) throw new ToolRunnerError("FREEOS MPFB smoke-test driver is missing.", "blocked");

  const expectedManifest = inside(rootDir, resolve(rootDir, "generated", "operators", "blender", "mpfb-smoke", jobKey, "manifest.json"));

  return await new Promise((resolveResult, reject) => {
    const child = spawn(blender.executablePath!, [
      "--background",
      "--python",
      script,
      "--",
      "--root",
      resolve(rootDir),
      "--job-key",
      jobKey,
    ], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, value?: MpfbSmokeResult & { stdoutTail: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveResult(value!);
    };

    const tryFinishFromEvidence = (): boolean => {
      if (settled || !stdout.includes("FREEOS_MPFB_SMOKE_RESULT=")) return false;
      try {
        const marker = parseMarker(stdout);
        const manifest = readVerifiedManifest(expectedManifest, marker);
        finish(undefined, { ...manifest, stdoutTail: tail(stdout, stderr) });
        // MPFB/Blender extensions can keep background Blender alive after the
        // fixed script has already flushed its verified manifest/result. Do
        // not make Tool Runner wait for unrelated shutdown cleanup.
        if (!child.killed) child.kill();
        return true;
      } catch {
        // The stdout JSON or manifest may still be mid-write. A later data
        // event or the process close handler will perform the strict check.
        return false;
      }
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(new ToolRunnerError("MPFB base-human smoke test timed out.", "blocked"));
    }, 180_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (stdout.length < 2 * 1024 * 1024) stdout += chunk;
      tryFinishFromEvidence();
    });
    child.stderr.on("data", chunk => { if (stderr.length < 512 * 1024) stderr += chunk; });
    child.once("error", () => finish(new ToolRunnerError("Blender could not start for the MPFB smoke test.", "blocked")));
    child.once("close", code => {
      if (settled) return;
      try {
        if (code !== 0) throw new ToolRunnerError(`MPFB smoke test failed.${tail(stdout, stderr) ? ` ${tail(stdout, stderr)}` : ""}`, "blocked");
        const marker = parseMarker(stdout);
        const manifest = readVerifiedManifest(expectedManifest, marker);
        finish(undefined, { ...manifest, stdoutTail: tail(stdout, stderr) });
      } catch (error) {
        finish(error instanceof Error ? error : new ToolRunnerError("MPFB smoke test failed.", "blocked"));
      }
    });
  });
}
