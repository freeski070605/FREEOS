import "dotenv/config";

const baseUrl = (process.env.SEARXNG_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const url = new URL(`${baseUrl}/search`);
url.search = new URLSearchParams({ q: "test", format: "json" }).toString();

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const count = Array.isArray(payload.results) ? payload.results.length : 0;
  console.log(`[FREEOS] SearXNG online: ${baseUrl}`);
  console.log(`[FREEOS] Test results: ${count}`);
  console.log("[FREEOS] Paid API keys required: no");
} catch (error) {
  console.log(`[FREEOS] SearXNG offline / setup needed: ${baseUrl}`);
  console.log(`[FREEOS] ${error instanceof Error ? error.message : "Connection failed."}`);
  console.log("[FREEOS] FREEOS can still run; see docs/SEARXNG_SETUP_WINDOWS.md.");
}
