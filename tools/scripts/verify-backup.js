import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."); const base = join(root, "exports", "backups");
console.log("FREEOS v1 Backup Verification\n");
if (!existsSync(base)) { console.error(`FAIL Backup root is missing: ${base}`); process.exit(1); }
const folders = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, path: join(base, entry.name), time: statSync(join(base, entry.name)).mtimeMs })).sort((a, b) => b.time - a.time);
if (!folders.length) { console.error("FAIL No backup folders found. Run npm run backup:freeos first."); process.exit(1); }
const latest = folders[0]; const manifestPath = join(latest.path, "backup-manifest.json"); let failed = 0;
console.log(`Latest backup: ${latest.name}`); console.log(`Recent backups found: ${folders.length}`);
let manifest = null;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); console.log("PASS backup-manifest.json - readable JSON"); } catch (error) { console.log(`FAIL backup-manifest.json - ${error instanceof Error ? error.message : "missing or invalid"}`); failed += 1; }
const selected = [
  ["freeos.sqlite", manifest?.requested?.includeDatabase ?? manifest?.files?.includes("freeos.sqlite")],
  ["projects", manifest?.requested?.includeProjects ?? manifest?.files?.includes("projects")],
  ["docs", manifest?.requested?.includeDocs ?? manifest?.files?.includes("docs")],
];
for (const [name, expected] of selected) {
  if (!expected) { console.log(`SKIP ${name} - not selected by manifest`); continue; }
  const target = join(latest.path, name); const valid = existsSync(target) && (name !== "freeos.sqlite" || statSync(target).size > 0);
  console.log(`${valid ? "PASS" : "FAIL"} ${name} - ${valid ? "included" : "selected but missing or empty"}`); if (!valid) failed += 1;
}
const files = [];
function walk(folder) { for (const entry of readdirSync(folder, { withFileTypes: true })) { const path = join(folder, entry.name); if (entry.isDirectory()) walk(path); else files.push(relative(latest.path, path).split(sep).join("/")); } }
walk(latest.path);
const forbidden = files.filter((path) => /(^|\/)\.env(?:\..*)?$/i.test(path) || /(^|\/)node_modules\//i.test(path) || /^services\/whispercpp\/(source|models)\//i.test(path) || /\.(gguf|safetensors|onnx|pt|pth)$/i.test(path) || /(^|\/)(voice\/(output|recordings)|generated)(\/|$).+\.(wav|mp3|ogg|webm|m4a|flac)$/i.test(path));
console.log(`${forbidden.length ? "FAIL" : "PASS"} exclusions - ${forbidden.length ? `unsafe content found: ${forbidden.slice(0, 5).join(", ")}` : ".env, dependencies, models, service sources, and generated audio are absent"}`); if (forbidden.length) failed += 1;
console.log(`\nLatest backup status: ${failed ? "FAILED" : "VERIFIED"}`); if (failed) process.exitCode = 1;
