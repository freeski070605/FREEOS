import "dotenv/config";

const baseUrl = (process.env.SEARXNG_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function runQuery(query) {
  const url = new URL(`${baseUrl}/search`);
  url.search = new URLSearchParams({ q: query, format: "json" }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: "application/json", "User-Agent": "FREEOS/0.1 local research" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return {
    query,
    count: Array.isArray(payload.results) ? payload.results.length : 0,
    engines: Array.isArray(payload.results)
      ? [...new Set(payload.results.flatMap(item => Array.isArray(item.engines) ? item.engines : item.engine ? [item.engine] : []))].slice(0, 12)
      : [],
    unresponsive: Array.isArray(payload.unresponsive_engines) ? payload.unresponsive_engines.slice(0, 12) : [],
  };
}

try {
  const aggregate = await runQuery("Blender official documentation");
  console.log(`[FREEOS] SearXNG online: ${baseUrl}`);
  console.log(`[FREEOS] Aggregate test results: ${aggregate.count}`);
  console.log("[FREEOS] Paid API keys required: no");

  if (aggregate.count > 0) {
    console.log(`[FREEOS] Result engines: ${aggregate.engines.join(", ") || "reported by SearXNG"}`);
    console.log("[FREEOS] JIT web search: verified");
  } else {
    console.log("[FREEOS] Aggregate search returned zero results; probing direct no-key engines...");
    if (aggregate.unresponsive.length) console.log(`[FREEOS] Aggregate unresponsive engines: ${JSON.stringify(aggregate.unresponsive)}`);

    let verified = false;
    for (const engine of ["duckduckgo", "google", "bing", "startpage"]) {
      try {
        const probe = await runQuery(`!${engine} Blender official documentation`);
        console.log(`[FREEOS] ${engine}: ${probe.count} result(s)${probe.unresponsive.length ? `; unresponsive=${JSON.stringify(probe.unresponsive)}` : ""}`);
        if (probe.count > 0) verified = true;
      } catch (error) {
        console.log(`[FREEOS] ${engine}: probe failed (${error instanceof Error ? error.message : "unknown error"})`);
      }
    }

    if (verified) {
      console.log("[FREEOS] JIT web search: verified through direct engine fallback");
    } else {
      console.log("[FREEOS] Search API is reachable, but no tested engine returned usable results.");
      console.log("[FREEOS] Rerun: npm.cmd run setup:searxng");
      console.log("[FREEOS] The setup command now refreshes FREEOS search-engine settings and restarts SearXNG.");
      process.exitCode = 2;
    }
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
