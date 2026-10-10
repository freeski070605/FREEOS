import "dotenv/config";

const baseUrl = (process.env.SEARXNG_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const url = new URL(`${baseUrl}/search`);
url.search = new URLSearchParams({ q: "Blender official documentation", format: "json", categories: "general" }).toString();

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json", "User-Agent": "FREEOS/0.1 local research" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const count = Array.isArray(payload.results) ? payload.results.length : 0;
  console.log(`[FREEOS] SearXNG online: ${baseUrl}`);
  console.log(`[FREEOS] Test results: ${count}`);
  console.log("[FREEOS] Paid API keys required: no");
  if (count < 1) {
    const errors = Array.isArray(payload.unresponsive_engines) ? payload.unresponsive_engines : [];
    console.log("[FREEOS] Search API is reachable, but no usable results were returned.");
    if (errors.length) console.log(`[FREEOS] Unresponsive engines: ${JSON.stringify(errors.slice(0, 10))}`);
    console.log("[FREEOS] JIT tool learning should not be considered healthy until a normal public query returns results.");
    process.exitCode = 2;
  } else {
    console.log("[FREEOS] JIT web search: verified");
  }
} catch (error) {
  console.log(`[FREEOS] SearXNG offline / setup needed: ${baseUrl}`);
  console.log(`[FREEOS] ${error instanceof Error ? error.message : "Connection failed."}`);
  if (process.env.SEARXNG_WSL_DISTRO) {
    console.log("[FREEOS] WSL SearXNG is configured. Try: npm.cmd run start:searxng");
  } else {
    console.log("[FREEOS] No local SearXNG runtime is configured. Try: npm.cmd run setup:searxng");
  }
  console.log("[FREEOS] FREEOS can still run; see docs/SEARXNG_SETUP_WINDOWS.md.");
  process.exitCode = 1;
}
