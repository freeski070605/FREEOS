import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const animation = require(resolve(process.cwd(), "packages/animation-core/dist/index.js"));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const wait = args.includes("--wait");

function valueArg(name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length).trim();
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function safeSegment(value) {
  return String(value || "shot").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "shot";
}

function slash(value) {
  return value.replace(/\\/g, "/");
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

function stableSeed(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

async function stageCopy(source, destination, inputRoot) {
  await copyFile(resolve(source), destination);
  return slash(relative(inputRoot, destination));
}

async function extractControlClip(job, destination, ffmpeg) {
  const duration = Math.max(0.001, job.controlEnd - job.controlStart);
  const width = job.generation.width;
  const height = job.generation.height;
  const fps = job.generation.fps;
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", job.sourcePath,
    "-ss", String(job.controlStart),
    "-t", String(duration),
    "-an",
    "-vf", filter,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    destination,
  ]);
}

async function extractReferenceFrame(job, destination, ffmpeg) {
  const at = job.referenceFrameTimes?.[0] ?? job.sourceStart;
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(at),
    "-i", job.sourcePath,
    "-frames:v", "1",
    "-q:v", "2",
    destination,
  ]);
}

async function waitForPrompt(promptId, endpoint, timeoutSeconds) {
  const started = Date.now();
  while ((Date.now() - started) / 1000 < timeoutSeconds) {
    const history = await animation.comfyPromptHistory(promptId, { endpoint, timeoutMs: 10000 });
    const files = animation.extractComfyOutputFiles(history, promptId);
    if (files.length) return { history, files };
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`Timed out waiting ${timeoutSeconds}s for ComfyUI prompt ${promptId}.`);
}

const planArg = valueArg("plan");
const workflowArg = valueArg("workflow");
const bindingArg = valueArg("binding");
const shotArg = valueArg("shot");
const inputDirArg = valueArg("input-dir") || process.env.FREEOS_COMFYUI_INPUT_DIR;
const endpointArg = valueArg("endpoint") || process.env.FREEOS_COMFYUI_URL;
const ffmpeg = valueArg("ffmpeg") || process.env.FREEOS_FFMPEG || "ffmpeg";
const positiveArg = valueArg("positive");
const negativeArg = valueArg("negative");
const seedArg = valueArg("seed");
const waitSecondsArg = valueArg("wait-seconds");

if (!planArg || !workflowArg || !bindingArg) {
  fail('Usage: npm run animation:render -- --plan="path\\plan.json" --workflow="path\\vace-api.json" --binding="path\\vace-binding.json" [--shot=shot-001] [--dry-run] [--wait]');
}
if (!inputDirArg) {
  fail("Set FREEOS_COMFYUI_INPUT_DIR or pass --input-dir= with the local ComfyUI input directory.");
}

const inputRoot = resolve(inputDirArg);
const planDocument = await readJson(resolve(planArg));
const plan = planDocument.plan ?? planDocument;
if (plan?.version !== "freeos-animation-plan-v1") fail("The plan file is not a FREEOS animation plan v1 document.");

const jobs = animation.createRenderJobs(plan);
const job = shotArg ? jobs.find(candidate => candidate.shotId === shotArg || candidate.id === shotArg) : jobs[0];
if (!job) fail(`Animation shot '${shotArg}' was not found.`);

const stageRelative = join("freeos-animation", safeSegment(job.projectId), safeSegment(job.shotId));
const stageDirectory = resolve(inputRoot, stageRelative);
await mkdir(stageDirectory, { recursive: true });

const controlDestination = join(stageDirectory, "control.mp4");
await extractControlClip(job, controlDestination, ffmpeg);
const controlVideo = slash(relative(inputRoot, controlDestination));

let characterReference;
const approvedCharacter = job.characterBible?.approvedDesignImage || job.characterBible?.referenceImages?.[0];
if (approvedCharacter) {
  const characterDestination = join(stageDirectory, `character${extname(approvedCharacter) || ".png"}`);
  characterReference = await stageCopy(approvedCharacter, characterDestination, inputRoot);
} else {
  const characterDestination = join(stageDirectory, "character-source-frame.png");
  await extractReferenceFrame(job, characterDestination, ffmpeg);
  characterReference = slash(relative(inputRoot, characterDestination));
}

let styleReference;
const approvedStyle = job.styleBible?.referenceImages?.[0];
if (approvedStyle) {
  const styleDestination = join(stageDirectory, `style${extname(approvedStyle) || ".png"}`);
  styleReference = await stageCopy(approvedStyle, styleDestination, inputRoot);
}

const positivePrompt = positiveArg || job.styleBible?.prompt || "cinematic high-quality cartoon animation, preserve subject identity, clothing, performance motion, camera movement and scene geometry, clean linework, dimensional shading, temporal consistency";
const negativePrompt = negativeArg || job.styleBible?.negativePrompt || "identity drift, face morphing, flicker, wardrobe changes, disappearing jewelry, warped hands, duplicate limbs, background wobble, text, watermark";
const parsedSeed = seedArg === undefined ? stableSeed(job.id) : Number(seedArg);
if (!Number.isSafeInteger(parsedSeed) || parsedSeed < 0) fail("--seed must be a non-negative safe integer.");

const workflowTemplate = await readJson(resolve(workflowArg));
const binding = await readJson(resolve(bindingArg));
const workflow = animation.bindComfyWorkflow(workflowTemplate, binding, {
  job,
  controlVideo,
  characterReference,
  styleReference,
  positivePrompt,
  negativePrompt,
  seed: parsedSeed,
  outputPrefix: slash(job.outputPrefix),
});

const auditDirectory = resolve(process.cwd(), "generated", "animation", safeSegment(job.projectId), "manifests");
await mkdir(auditDirectory, { recursive: true });
const workflowAuditPath = join(auditDirectory, `${safeSegment(job.shotId)}-workflow.json`);
const jobAuditPath = join(auditDirectory, `${safeSegment(job.shotId)}-job.json`);
await writeFile(workflowAuditPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
await writeFile(jobAuditPath, JSON.stringify({
  version: "freeos-animation-render-job-v1",
  createdAt: new Date().toISOString(),
  job,
  staging: { inputRoot, stageDirectory, controlVideo, characterReference, styleReference },
  prompts: { positivePrompt, negativePrompt },
  seed: parsedSeed,
  workflow: { template: resolve(workflowArg), binding: resolve(bindingArg), bound: workflowAuditPath },
}, null, 2) + "\n", "utf8");

if (dryRun) {
  console.log(JSON.stringify({
    status: "prepared",
    dryRun: true,
    shotId: job.shotId,
    controlVideo,
    characterReference,
    styleReference,
    workflowAuditPath,
    jobAuditPath,
  }, null, 2));
  process.exit(0);
}

const status = await animation.comfyStatus(endpointArg, 5000);
if (!status.available) throw new Error(`ComfyUI is unavailable at ${status.endpoint}: ${status.reason || "unknown error"}`);
const queued = await animation.queueComfyWorkflow(workflow, { endpoint: status.endpoint, clientId: `freeos-animation-${safeSegment(job.id)}` });

const result = {
  status: "queued",
  shotId: job.shotId,
  promptId: queued.promptId,
  endpoint: queued.endpoint,
  workflowAuditPath,
  jobAuditPath,
};

if (!wait) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const waitSeconds = waitSecondsArg === undefined ? 900 : Number(waitSecondsArg);
if (!Number.isFinite(waitSeconds) || waitSeconds < 1 || waitSeconds > 86400) fail("--wait-seconds must be between 1 and 86400.");
const completed = await waitForPrompt(queued.promptId, queued.endpoint, waitSeconds);
console.log(JSON.stringify({ ...result, status: "completed", outputs: completed.files }, null, 2));
