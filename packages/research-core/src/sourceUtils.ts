import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export function domainFromUrl(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./i, ""); } catch { return "unknown"; }
}

export function assertPublicHttpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ResearchError("A valid public URL is required.", "validation"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ResearchError("Only public HTTP and HTTPS pages can be read.", "validation");
  const host = url.hostname.toLowerCase();
  const blocked = host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1";
  const privateIp = isIP(host) > 0 && isPrivateAddress(host);
  if (blocked || privateIp) throw new ResearchError("Private, loopback, and local-network pages are not available to the public page reader.", "validation");
  return url;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return /^(10\.|127\.|169\.254\.|192\.168\.)/.test(normalized)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
    || normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")
    || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export async function assertPublicResolvedUrl(value: string): Promise<URL> {
  const url = assertPublicHttpUrl(value);
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new ResearchError("The page hostname resolves to a private or local-network address.", "validation");
    }
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError("The public page hostname could not be resolved.", "fetch");
  }
  return url;
}

export class ResearchError extends Error {
  constructor(message: string, readonly code: "validation" | "not_found" | "conflict" | "offline" | "fetch" | "database") {
    super(message); this.name = "ResearchError";
  }
}
