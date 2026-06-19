import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(root, ".env"); let apiPort = process.env.API_PORT || "3001";
if (existsSync(envPath)) { const match = readFileSync(envPath, "utf8").match(/^\s*API_PORT\s*=\s*(\d+)\s*$/m); if (match) apiPort = match[1]; }
console.log("FREEOS v1 Release Check\n");
let failed = 0;
function run(script, required = true) { console.log(`\n=== npm run ${script} ===`); const result = process.platform === "win32" ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm run ${script}`], { cwd: root, stdio: "inherit" }) : spawnSync("npm", ["run", script], { cwd: root, stdio: "inherit" }); if (result.status !== 0 && required) failed += 1; return result.status === 0; }
run("env:check"); run("db:integrity");
if (existsSync(resolve(root, "tools/scripts/tools-status.js"))) run("tools:status");
run("backup:verify");
let apiOnline = false;
for (let attempt = 1; attempt <= 5 && !apiOnline; attempt += 1) {
  try { const response = await fetch(`http://127.0.0.1:${apiPort}/health`, { signal: AbortSignal.timeout(2500) }); apiOnline = response.ok; } catch {}
  if (!apiOnline && attempt < 5) await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
}
if (apiOnline) { run("command:status"); run("smoke:test"); }
else console.log("\nWARN API is not running; command status and smoke tests were skipped. Start npm run dev:api for the complete release check.");
console.log(`\nFREEOS v1 Release Check: ${failed ? `FAILED (${failed} required check group(s))` : "PASSED"}${apiOnline ? "" : " WITH API CHECKS SKIPPED"}`); if (failed) process.exitCode = 1;
