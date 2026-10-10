import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { getOperatorStatus } from "@freeos/operator-core";
import { recordCapabilityVerification } from "./capabilityVerification";
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

export interface MpfbPhenotypeProfile {
  gender: "neutral" | "male" | "female";
  age: "baby" | "child" | "young" | "old";
  muscle: "minmuscle" | "averagemuscle" | "maxmuscle";
  weight: "minweight" | "averageweight" | "maxweight";
  height: "minheight" | "average" | "maxheight";
  proportions: "min" | "average" | "max";
  race: "universal" | "african" | "asian" | "caucasian";
  influence: number;
}

export interface MpfbPhenotypeResult {
  ok: true;
  jobKey: string;
  adapter: string;
  operator: string;
  phenotypeVerified: true;
  renderVerified: true;
  propertyModule: string;
  requestedProfile: MpfbPhenotypeProfile;
  blendFile: string;
  renderFile: string;
  basemesh: string;
  vertexCount: number;
  polygonCount: number;
  shapeKeyCount: number;
  activeShapeKeys: Array<{ name: string; value: number }>;
  materialCount: number;
  diagnosticMaterial?: string;
  diagnosticMaterialAppliedCount?: number;
}

function inside(rootDir: string, candidate: string): string {
  const root = resolve(rootDir);
  const full = resolve(candidate);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (full.toLowerCase() !== root.toLowerCase() && !full.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new ToolRunnerError("MPFB adapter path escaped the FREEOS workspace.", "blocked");
  }
  return full;
}

function safeJobKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value.trim())) {
    throw new ToolRunnerError("jobKey must contain only letters, numbers, dot, underscore, or dash and be at most 80 characters.", "validation");
  }
  return value.trim();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ToolRunnerError(`${name} must be one of: ${allowed.join(", ")}.`, "validation");
  }
  return value as T;
}

export function normalizeMpfbPhenotypeProfile(value: unknown): MpfbPhenotypeProfile {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const influence = Number(input.influence ?? 0.8);
  if (!Number.isFinite(influence) || influence < 0 || influence > 1) {
    throw new ToolRunnerError("phenotype influence must be a number from 0 to 1.", "validation");
  }
  return {
    gender: enumValue(input.gender ?? "male", ["neutral", "male", "female"] as const, "gender"),
    age: enumValue(input.age ?? "young", ["baby", "child", "young", "old"] as const, "age"),
    muscle: enumValue(input.muscle ?? "averagemuscle", ["minmuscle", "averagemuscle", "maxmuscle"] as const, "muscle"),
    weight: enumValue(input.weight ?? "averageweight", ["minweight", "averageweight", "maxweight"] as const, "weight"),
    height: enumValue(input.height ?? "average", ["minheight", "average", "maxheight"] as const, "height"),
    proportions: enumValue(input.proportions ?? "max", ["min", "average", "max"] as const, "proportions"),
    race: enumValue(input.race ?? "universal", ["universal", "african", "asian", "caucasian"] as const, "race"),
    influence,
  };
}

function parseMarker<T>(stdout: string, prefix: string, verify: (value: T) => boolean, label: string): T {
  const line = stdout.split(/\r?\n/).reverse().find(item => item.startsWith(prefix));
  if (!line) throw new ToolRunnerError(`Blender exited without ${label} result evidence.`, "blocked");
  try {
    const parsed = JSON.parse(line.slice(prefix.length)) as T;
    if (!verify(parsed)) throw new Error("verification flags missing");
    return parsed;
  } catch {
    throw new ToolRunnerError(`${label} returned invalid verification evidence.`, "blocked");
  }
}

function readManifest<T>(expectedManifest: string, verify: (value: T) => boolean, label: string): T {
  if (!existsSync(expectedManifest)) throw new ToolRunnerError(`${label} did not create its verification manifest.`, "blocked");
  try {
    const manifest = JSON.parse(readFileSync(expectedManifest, "utf8")) as T;
    if (!verify(manifest)) throw new Error("verification flags missing");
    return manifest;
  } catch {
    throw new ToolRunnerError(`${label} manifest could not be parsed or did not contain verification flags.`, "blocked");
  }
}

function tail(stdout: string, stderr: string): string {
  return `${stderr}\n${stdout}`.trim().slice(-3000).replace(/[\r\n]+/g, " | ");
}

async function runFixedBlenderAdapter<T extends { jobKey: string; blendFile: string; renderFile: string }>(input: {
  rootDir: string;
  jobKey: string;
  scriptName: string;
  outputSubdir: string;
  markerPrefix: string;
  label: string;
  extraArgs?: string[];
  verify: (value: T) => boolean;
  onVerified: (manifest: T) => void;
}): Promise<T & { stdoutTail: string }> {
  const blender = getOperatorStatus("blender");
  if (!blender.ready || !blender.executablePath) throw new ToolRunnerError("Blender Operator is not ready.", "blocked");

  const script = inside(input.rootDir, resolve(input.rootDir, "packages", "operator-core", "scripts", input.scriptName));
  if (!existsSync(script)) throw new ToolRunnerError(`FREEOS ${input.label} driver is missing.`, "blocked");
  const expectedManifest = inside(input.rootDir, resolve(input.rootDir, "generated", "operators", "blender", input.outputSubdir, input.jobKey, "manifest.json"));

  return await new Promise((resolveResult, reject) => {
    const child = spawn(blender.executablePath!, [
      "--background", "--python", script, "--", "--root", resolve(input.rootDir), "--job-key", input.jobKey,
      ...(input.extraArgs ?? []),
    ], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, value?: T & { stdoutTail: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveResult(value!);
    };

    const verifyEvidence = (): T => {
      const marker = parseMarker<T>(stdout, input.markerPrefix, input.verify, input.label);
      const manifest = readManifest<T>(expectedManifest, input.verify, input.label);
      if (manifest.jobKey !== marker.jobKey || manifest.blendFile !== marker.blendFile || manifest.renderFile !== marker.renderFile) {
        throw new ToolRunnerError(`${input.label} stdout and manifest evidence do not match.`, "blocked");
      }
      input.onVerified(manifest);
      return manifest;
    };

    const tryFinishFromEvidence = (): boolean => {
      if (settled || !stdout.includes(input.markerPrefix)) return false;
      try {
        const manifest = verifyEvidence();
        finish(undefined, { ...manifest, stdoutTail: tail(stdout, stderr) });
        if (!child.killed) child.kill();
        return true;
      } catch {
        return false;
      }
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(new ToolRunnerError(`${input.label} timed out.`, "blocked"));
    }, 180_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (stdout.length < 2 * 1024 * 1024) stdout += chunk;
      tryFinishFromEvidence();
    });
    child.stderr.on("data", chunk => { if (stderr.length < 512 * 1024) stderr += chunk; });
    child.once("error", () => finish(new ToolRunnerError(`Blender could not start for ${input.label}.`, "blocked")));
    child.once("close", code => {
      if (settled) return;
      try {
        if (code !== 0) throw new ToolRunnerError(`${input.label} failed.${tail(stdout, stderr) ? ` ${tail(stdout, stderr)}` : ""}`, "blocked");
        const manifest = verifyEvidence();
        finish(undefined, { ...manifest, stdoutTail: tail(stdout, stderr) });
      } catch (error) {
        finish(error instanceof Error ? error : new ToolRunnerError(`${input.label} failed.`, "blocked"));
      }
    });
  });
}

export async function runMpfbBaseSmokeTest(rootDir: string, rawJobKey: unknown): Promise<MpfbSmokeResult & { stdoutTail: string }> {
  const jobKey = safeJobKey(rawJobKey);
  return await runFixedBlenderAdapter<MpfbSmokeResult>({
    rootDir,
    jobKey,
    scriptName: "blender_mpfb_smoke.py",
    outputSubdir: "mpfb-smoke",
    markerPrefix: "FREEOS_MPFB_SMOKE_RESULT=",
    label: "MPFB base-human smoke test",
    verify: value => value?.ok === true && value.baseHumanVerified === true && value.renderVerified === true,
    onVerified: manifest => {
      recordCapabilityVerification({
        capabilityKey: "blender.mpfb.base-human",
        operatorKey: "blender",
        toolName: "MPFB / MakeHuman",
        verificationKind: manifest.adapter,
        evidence: manifest as unknown as Record<string, unknown>,
      });
    },
  });
}

export async function runMpfbPhenotypeTest(rootDir: string, rawJobKey: unknown, rawProfile: unknown): Promise<MpfbPhenotypeResult & { stdoutTail: string }> {
  const jobKey = safeJobKey(rawJobKey);
  const profile = normalizeMpfbPhenotypeProfile(rawProfile);
  return await runFixedBlenderAdapter<MpfbPhenotypeResult>({
    rootDir,
    jobKey,
    scriptName: "blender_mpfb_phenotype.py",
    outputSubdir: "mpfb-phenotype",
    markerPrefix: "FREEOS_MPFB_PHENOTYPE_RESULT=",
    label: "MPFB phenotype verification",
    extraArgs: [
      "--gender", profile.gender,
      "--age", profile.age,
      "--muscle", profile.muscle,
      "--weight", profile.weight,
      "--height", profile.height,
      "--proportions", profile.proportions,
      "--race", profile.race,
      "--influence", String(profile.influence),
    ],
    verify: value => value?.ok === true && value.phenotypeVerified === true && value.renderVerified === true && Array.isArray(value.activeShapeKeys) && value.activeShapeKeys.length > 0,
    onVerified: manifest => {
      recordCapabilityVerification({
        capabilityKey: "blender.mpfb.phenotype-control",
        operatorKey: "blender",
        toolName: "MPFB / MakeHuman",
        verificationKind: manifest.adapter,
        evidence: manifest as unknown as Record<string, unknown>,
      });
    },
  });
}
