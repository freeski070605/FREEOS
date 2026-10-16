import { stat } from "node:fs/promises";
import { adobeService } from "../../adobe.service";

const cache = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 32;

export async function analyzeMediaCached(kind: "audio" | "video", path: string, sampleFps?: number): Promise<{ result: unknown; cacheHit: boolean }> {
  const info = await stat(path).catch(() => null);
  if (!info) {
    return { result: await adobeService.run("media", kind === "audio" ? "media.audio.analyze" : "media.video.analyze", kind === "audio" ? { path } : { path, sampleFps }), cacheHit: false };
  }
  const key = JSON.stringify([kind, path, info.size, info.mtimeMs, sampleFps]);
  const hit = cache.get(key);
  if (hit) return { result: await hit, cacheHit: true };
  const operation = adobeService.run("media", kind === "audio" ? "media.audio.analyze" : "media.video.analyze", kind === "audio" ? { path } : { path, sampleFps });
  cache.set(key, operation);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  try { return { result: await operation, cacheHit: false }; }
  catch (error) { cache.delete(key); throw error; }
}
