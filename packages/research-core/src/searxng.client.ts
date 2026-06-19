import { domainFromUrl, ResearchError } from "./sourceUtils";
import type { NormalizedSearchResult, SearchOptions } from "./research.types";

type RawResult = Record<string, unknown>;

export async function checkSearxngStatus(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("search", `${baseUrl.replace(/\/$/, "")}/`);
    url.search = new URLSearchParams({ q: "FREEOS status check", format: "json" }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { Accept: "application/json" } });
    if (!response.ok) return false;
    const data = await response.json() as { results?: unknown };
    return Array.isArray(data.results);
  } catch { return false; }
}

export function normalizeSearchResults(rawResults: unknown): NormalizedSearchResult[] {
  if (!Array.isArray(rawResults)) return [];
  return rawResults.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as RawResult;
    if (typeof raw.url !== "string" || !/^https?:\/\//i.test(raw.url)) return [];
    const domain = domainFromUrl(raw.url);
    const engines = Array.isArray(raw.engines) ? raw.engines.filter((v): v is string => typeof v === "string") : [];
    return [{
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : raw.url,
      url: raw.url,
      snippet: typeof raw.content === "string" ? raw.content.trim() : "",
      source: typeof raw.engine === "string" ? raw.engine : engines[0] ?? domain,
      domain,
    }];
  });
}

export async function searchSearxng(baseUrl: string, query: string, options: SearchOptions = {}): Promise<NormalizedSearchResult[]> {
  if (!query.trim()) throw new ResearchError("query is required.", "validation");
  const maxResults = Math.min(Math.max(Math.trunc(options.maxResults ?? 5), 1), 20);
  try {
    const url = new URL("search", `${baseUrl.replace(/\/$/, "")}/`);
    url.search = new URLSearchParams({ q: query.trim(), format: "json", ...(options.language ? { language: options.language } : {}) }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json", "User-Agent": "FREEOS/0.1 local research" } });
    if (!response.ok) throw new ResearchError(`SearXNG returned HTTP ${response.status}.`, "offline");
    const payload = await response.json() as { results?: unknown };
    return normalizeSearchResults(payload.results).slice(0, maxResults);
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError("SearXNG is offline or not configured. Start a local instance or set SEARXNG_BASE_URL, then try again.", "offline");
  }
}
