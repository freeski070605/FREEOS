import * as cheerio from "cheerio";
import { assertPublicResolvedUrl, domainFromUrl, ResearchError } from "./sourceUtils";
import type { PageReadResult } from "./research.types";

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 60_000;
const MAX_PREVIEW = 12_000;

export function extractReadableText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title = ($("meta[property='og:title']").attr("content") || $("title").first().text() || $("h1").first().text()).trim();
  $("script,style,noscript,svg,canvas,iframe,nav,header,footer,aside,form").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const text = root.text().replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim().slice(0, MAX_TEXT);
  return { title, text };
}

export async function readPublicPage(value: string): Promise<PageReadResult> {
  let url = await assertPublicResolvedUrl(value);
  let response: Response;
  try {
    let redirects = 0;
    while (true) {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "FREEOS/0.1 local page reader" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects++ >= 5) throw new ResearchError("The public page redirect chain is invalid or too long.", "fetch");
      url = await assertPublicResolvedUrl(new URL(location, url).toString());
    }
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError("The public page could not be reached within the read timeout.", "fetch");
  }
  if (!response.ok) throw new ResearchError(`The public page returned HTTP ${response.status}.`, "fetch");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new ResearchError("The page reader currently supports public HTML pages only.", "validation");
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_BYTES) throw new ResearchError("The page is larger than the 2 MB reader limit.", "validation");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) throw new ResearchError("The page is larger than the 2 MB reader limit.", "validation");
  const finalUrl = response.url || url.toString();
  const { title, text } = extractReadableText(new TextDecoder().decode(buffer));
  if (!text) throw new ResearchError("No readable public-page text was found.", "fetch");
  return { title: title || domainFromUrl(finalUrl), url: finalUrl, domain: domainFromUrl(finalUrl), text, contentPreview: text.slice(0, MAX_PREVIEW), bytesRead: buffer.byteLength };
}
