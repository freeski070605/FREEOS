import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function loadEnv() {
  if (!existsSync(resolve(root, ".env"))) return {};
  return Object.fromEntries(readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/).map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((match) => [match[1], match[2].replace(/^(["'])(.*)\1$/, "$2")]));
}
const fileEnv = loadEnv();
const value = (key, fallback = "") => process.env[key] ?? fileEnv[key] ?? fallback;
let requiredFailures = 0; let warnings = 0;
const report = (kind, label, detail) => { console.log(`${kind.padEnd(8)} ${label} - ${detail}`); if (kind === "FAIL") requiredFailures += 1; if (kind === "WARN") warnings += 1; };
const requiredPath = (label, path) => report(existsSync(resolve(root, path)) ? "PASS" : "FAIL", label, path);
const optionalPath = (label, path) => report(existsSync(resolve(root, path)) ? "PASS" : "WARN", label, path);

console.log("FREEOS v1 Environment Check\n");
const nodeMajor = Number(process.versions.node.split(".")[0]); report(nodeMajor >= 20 ? "PASS" : "FAIL", "Node version", process.version);
const npm = process.platform === "win32"
  ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm --version"], { encoding: "utf8" })
  : spawnSync("npm", ["--version"], { encoding: "utf8" });
report(npm.status === 0 ? "PASS" : "FAIL", "npm version", npm.status === 0 ? npm.stdout.trim() : "npm is unavailable");
report(existsSync(resolve(root, "package.json")) ? "PASS" : "FAIL", "Project root", root);
requiredPath("SQLite database", "data/freeos.sqlite"); requiredPath("Projects folder", "data/projects"); requiredPath("Backup folder", "exports/backups");
report(existsSync(resolve(root, ".env")) ? "PASS" : "WARN", ".env file", existsSync(resolve(root, ".env")) ? "present" : "missing; copy .env.example to .env");
optionalPath("Voice recordings", value("VOICE_RECORDINGS_DIR", "data/voice/recordings")); optionalPath("Voice output", value("VOICE_OUTPUT_DIR", "data/voice/output")); optionalPath("Voice transcripts", "data/voice/transcripts");

async function reachable(label, url, path = "") {
  try { const response = await fetch(`${url.replace(/\/$/, "")}${path}`, { signal: AbortSignal.timeout(2500) }); report(response.ok ? "PASS" : "WARN", label, `${url} returned HTTP ${response.status}`); }
  catch { report("WARN", label, `${url} is offline or unavailable`); }
}
await reachable("Ollama", value("OLLAMA_BASE_URL", "http://127.0.0.1:11434"), "/api/tags");
await reachable("SearXNG", value("SEARXNG_BASE_URL", "http://127.0.0.1:8080"));
const ffmpeg = spawnSync(value("FFMPEG_PATH", "ffmpeg"), ["-version"], { encoding: "utf8" }); report(ffmpeg.status === 0 ? "PASS" : "WARN", "FFmpeg", ffmpeg.status === 0 ? "available" : "not found; voice conversion may be unavailable");
const whisperKeys = ["WHISPER_CPP_PATH", "WHISPER_MODEL_PATH", "WHISPER_MODEL_FAST_PATH", "WHISPER_MODEL_BALANCED_PATH", "WHISPER_MODEL_QUALITY_PATH"];
const configuredWhisper = whisperKeys.filter((key) => value(key));
if (!configuredWhisper.length) report("WARN", "Whisper paths", "not configured; speech-to-text remains optional");
else for (const key of configuredWhisper) report(existsSync(resolve(root, value(key))) || existsSync(value(key)) ? "PASS" : "WARN", key, existsSync(resolve(root, value(key))) || existsSync(value(key)) ? "configured path exists" : "configured path is missing");
const unsafeKeys = ["DANGEROUS_ACTIONS_ENABLED", "FREEOS_DANGEROUS_ACTIONS", "AUTO_RUN_TOOLS", "AUTO_APPROVE_MEMORY", "ALWAYS_LISTENING"];
const unsafe = unsafeKeys.filter((key) => /^(1|true|yes|on)$/i.test(value(key)));
report(unsafe.length ? "FAIL" : "PASS", "Safety switches", unsafe.length ? `unsafe values enabled: ${unsafe.join(", ")}` : "dangerous actions, auto-run, auto-approval, and always-listening are disabled");
console.log(`\nSummary: ${requiredFailures} required failure(s), ${warnings} warning(s).`); if (requiredFailures) process.exitCode = 1;
