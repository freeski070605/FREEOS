import "dotenv/config";
import { getResearchService } from "@freeos/research-core";

const searxngBaseUrl = (process.env.SEARXNG_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const service = getResearchService();
const counts = service.getStatusCounts();
const connected = async (url) => { try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); return response.ok; } catch { return false; } };
const searchUrl = new URL(`${searxngBaseUrl}/search`); searchUrl.search = new URLSearchParams({ q: "FREEOS status", format: "json" }).toString();
const [searxngOnline, ollamaOnline] = await Promise.all([connected(searchUrl), connected(`${ollamaBaseUrl}/api/tags`)]);
console.log(`[FREEOS] Research sessions: ${counts.sessions}`);
console.log(`[FREEOS] Research results: ${counts.results}`);
console.log(`[FREEOS] Tracked sources: ${counts.sources}`);
console.log(`[FREEOS] SearXNG: ${searxngOnline ? "online" : "offline / setup needed"} (${searxngBaseUrl})`);
console.log(`[FREEOS] Ollama: ${ollamaOnline ? "connected" : "offline"} (${ollamaBaseUrl})`);
service.close();
