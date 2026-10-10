import { domainFromUrl, ResearchError } from "./sourceUtils";
import type { NormalizedSearchResult, SearchOptions } from "./research.types";

type RawResult = Record<string, unknown>;

function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripQueryNoise(value: string): string {
  return compactSpaces(value)
    .replace(/\b(the|a|an|this|that|requested|objective|current|highest|best|possible|practical|premium|production-ready|professional|polished)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * SearXNG engines can return zero results for long natural-language planning queries.
 * Build a bounded search ladder that preserves exact tool/version terms first and
 * progressively removes the task prose. This is deterministic and does not invent
 * new claims; it only changes the retrieval query.
 */
export function buildSearxngQueryVariants(query: string): string[] {
  const original = compactSpaces(query);
  if (!original) return [];

  const variants: string[] = [original];
  const lower = original.toLowerCase();
  const anchors = [
    " official documentation",
    " documentation",
    " developer documentation",
    " user manual",
    " manual",
    " api reference",
    " operators reference",
    " tutorial",
    " guide",
    " release notes",
  ];

  for (const anchor of anchors) {
    const index = lower.indexOf(anchor);
    if (index < 0) continue;
    const throughAnchor = original.slice(0, index + anchor.length).trim();
    if (throughAnchor.length >= 8) variants.push(throughAnchor);
    const beforeAnchor = original.slice(0, index).trim();
    if (beforeAnchor.length >= 8) variants.push(beforeAnchor);
    break;
  }

  const tokens = original.split(" ").filter(Boolean);
  if (tokens.length > 14) variants.push(tokens.slice(0, 14).join(" "));
  if (tokens.length > 10) variants.push(tokens.slice(0, 10).join(" "));

  const stripped = stripQueryNoise(original);
  if (stripped && stripped !== original) {
    const strippedTokens = stripped.split(" ").filter(Boolean);
    variants.push(strippedTokens.slice(0, Math.min(14, strippedTokens.length)).join(" "));
  }

  return Array.from(new Set(variants.map(compactSpaces).filter(value => value.length >= 3))).slice(0, 5);
}

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

async function executeSearch(baseUrl: string, query: string, options: SearchOptions): Promise<NormalizedSearchResult[]> {
  const maxResults = Math.min(Math.max(Math.trunc(options.maxResults ?? 5), 1), 20);
  const url = new URL("search", `${baseUrl.replace(/\/$/, "")}/`);
  url.search = new URLSearchParams({
    q: query.trim(),
    format: "json",
    categories: "general",
    ...(options.language ? { language: options.language } : {}),
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json", "User-Agent": "FREEOS/0.1 local research" },
  });
  if (!response.ok) throw new ResearchError(`SearXNG returned HTTP ${response.status}.`, "offline");
  const payload = await response.json() as { results?: unknown };
  return normalizeSearchResults(payload.results).slice(0, maxResults);
}

export async function searchSearxng(baseUrl: string, query: string, options: SearchOptions = {}): Promise<NormalizedSearchResult[]> {
  if (!query.trim()) throw new ResearchError("query is required.", "validation");
  try {
    const variants = buildSearxngQueryVariants(query);
    for (const variant of variants) {
      const results = await executeSearch(baseUrl, variant, options);
      if (results.length) return results;
    }
    return [];
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError("SearXNG is offline or not configured. Start a local instance or set SEARXNG_BASE_URL, then try again.", "offline");
  }
}
