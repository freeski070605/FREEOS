import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const { analyzeVideo } = require(resolve(process.cwd(), "packages/media-intelligence/dist/index.js"));
const { buildAnimationPlan, createRenderJobs } = require(resolve(process.cwd(), "packages/animation-core/dist/index.js"));

const args = process.argv.slice(2);
const modeArg = args.find(value => value.startsWith("--mode="));
const sampleArg = args.find(value => value.startsWith("--sample-fps="));
const projectArg = args.find(value => value.startsWith("--project="));
let raw = args.filter(value => !value.startsWith("--" )).join(" ").trim();

if (process.platform === "win32") {
  raw = raw.replace(/^\^+/, "").replace(/\^+$/, "").replace(/\^(?=[ ()&|<>^])/g, "");
}

const target = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  ? raw.slice(1, -1).trim()
  : raw;

if (!target) {
  console.error('Usage: npm run animation:plan -- "E:\\path\\to\\video.mp4" [--mode=preview|local-final|ultra] [--sample-fps=2] [--project=name]');
  process.exit(2);
}

const qualityMode = modeArg?.slice("--mode=".length) || "local-final";
if (!["preview", "local-final", "ultra"].includes(qualityMode)) {
  console.error(`Unsupported animation mode '${qualityMode}'.`);
  process.exit(2);
}

const sampleFps = sampleArg ? Number(sampleArg.slice("--sample-fps=".length)) : 2;
if (!Number.isFinite(sampleFps) || sampleFps < 0.25 || sampleFps > 6) {
  console.error("--sample-fps must be between 0.25 and 6.");
  process.exit(2);
}

const fallbackProject = basename(target).replace(/\.[^.]+$/, "") || "animation-project";
const projectId = projectArg?.slice("--project=".length).trim() || fallbackProject;

try {
  const analysis = await analyzeVideo(target, { sampleFps });
  const plan = buildAnimationPlan(analysis, { projectId, qualityMode });
  const jobs = createRenderJobs(plan);
  process.stdout.write(JSON.stringify({ plan, jobs }, null, 2) + "\n");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
