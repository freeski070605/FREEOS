import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function envFile() {
  try {
    return Object.fromEntries(readFileSync(resolve(".env"), "utf8").split(/\r?\n/).map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((match) => [match[1], match[2].replace(/^(["'])(.*)\1$/, "$2")]));
  } catch { return {}; }
}

const localEnv = envFile();
const port = process.env.API_PORT || localEnv.API_PORT || "3001";
const baseUrl = (process.env.FREEOS_API_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const checks = [
  ["/health", false], ["/system/status", false], ["/ollama/status", true], ["/memory/status", false],
  ["/projects/status", false], ["/research/status", true], ["/voice/status", true], ["/tools/status", false],
  ["/automations/status", false], ["/command/status", false], ["/command/activity", false],
  ["/command/approvals", false], ["/command/backup/status", false],
];

console.log(`FREEOS v1 Smoke Test\nAPI: ${baseUrl}\n`);
let passed = 0;
for (const [path, optionalService] of checks) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    const payload = await response.json().catch(() => null);
    const jsonOk = payload !== null && typeof payload === "object";
    const optionalOffline = optionalService && [424, 502, 503].includes(response.status);
    const ok = jsonOk && (response.ok || optionalOffline);
    if (ok) passed += 1;
    const setupNeeded = payload && typeof payload === "object" && (payload.connected === false || payload.searxngOnline === false || payload.sttConfigured === false || payload.ttsConfigured === false);
    const message = !jsonOk ? "endpoint did not return JSON" : optionalOffline || setupNeeded ? "endpoint healthy; optional local service is offline or needs setup" : response.ok ? "endpoint responded with JSON" : "unexpected API response";
    console.log(`${ok ? "PASS" : "FAIL"} ${String(response.status).padEnd(3)} ${path} - ${message}`);
  } catch (error) {
    console.log(`FAIL --- ${path} - ${error instanceof Error ? error.message : "request failed"}`);
  }
}

const failed = checks.length - passed;
console.log(`\nSummary: ${passed}/${checks.length} passed, ${failed} failed.`);
if (failed) {
  console.log("Start the FREEOS API with npm run dev:api, then retry.");
  process.exitCode = 1;
}
