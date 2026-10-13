$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\adobe-worker\src\index.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('FREEOS_MEDIA_ANALYSIS_CACHE_V1')) {
  Write-Host '[FREEOS] Adobe worker media analysis cache is already installed.' -ForegroundColor Yellow
  exit 0
}

$fsOld = 'import { readFileSync, existsSync, mkdirSync, appendFileSync, copyFileSync } from "node:fs";'
$fsNew = 'import { readFileSync, existsSync, mkdirSync, appendFileSync, copyFileSync, statSync, writeFileSync } from "node:fs";'
if (-not $content.Contains($fsOld)) { throw 'Could not find adobe-worker node:fs import.' }
$content = $content.Replace($fsOld, $fsNew)

$cryptoOld = 'import { randomUUID, timingSafeEqual } from "node:crypto";'
$cryptoNew = 'import { randomUUID, timingSafeEqual, createHash } from "node:crypto";'
if (-not $content.Contains($cryptoOld)) { throw 'Could not find adobe-worker node:crypto import.' }
$content = $content.Replace($cryptoOld, $cryptoNew)

$insertMarker = 'let videoStatusAt = Date.now();'
if (-not $content.Contains($insertMarker)) { throw 'Could not find videoStatusAt marker.' }
$cacheBlock = @'

// FREEOS_MEDIA_ANALYSIS_CACHE_V1
const mediaAnalysisCacheRoot = resolve(env.FREEOS_ADOBE_MEDIA_CACHE_PATH || resolve(root, "data/adobe-worker/media-cache"));
const mediaAnalysisCacheSchema = "1";

function mediaAnalysisCacheFile(kind: "audio" | "video", path: string, variant: Record<string, unknown>): string {
  const stat = statSync(path);
  const fingerprint = JSON.stringify({
    schema: mediaAnalysisCacheSchema,
    kind,
    path: resolve(path).toLowerCase(),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    variant,
  });
  const key = createHash("sha256").update(fingerprint).digest("hex");
  return resolve(mediaAnalysisCacheRoot, `${kind}-${key}.json`);
}

async function cachedMediaAnalysis<T>(kind: "audio" | "video", path: string, variant: Record<string, unknown>, producer: () => Promise<T>): Promise<T> {
  if (env.FREEOS_ADOBE_MEDIA_CACHE_ENABLED === "false") return producer();
  const cacheFile = mediaAnalysisCacheFile(kind, path, variant);
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as { schema?: string; value?: T };
      if (cached.schema === mediaAnalysisCacheSchema && cached.value !== undefined) {
        console.log(`[FREEOS media cache] hit ${kind}: ${path}`);
        return cached.value;
      }
    } catch {
      // Corrupt cache entries are ignored and recomputed.
    }
  }
  const value = await producer();
  mkdirSync(mediaAnalysisCacheRoot, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ schema: mediaAnalysisCacheSchema, createdAt: new Date().toISOString(), value }), "utf8");
  console.log(`[FREEOS media cache] miss ${kind}: ${path}`);
  return value;
}
'@
$content = $content.Replace($insertMarker, $insertMarker + $cacheBlock)

$audioOld = @'
  if (command.action === "media.audio.analyze") {
    const path = resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS || "");
    return result(command, "complete", "filesystem", await analyzeAudio(path));
  }
'@
$audioNew = @'
  if (command.action === "media.audio.analyze") {
    const path = resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS || "");
    const output = await cachedMediaAnalysis("audio", path, {}, () => analyzeAudio(path));
    return result(command, "complete", "filesystem", output);
  }
'@
if (-not $content.Contains($audioOld)) { throw 'Could not find media.audio.analyze block.' }
$content = $content.Replace($audioOld, $audioNew)

$videoOld = @'
  if (command.action === "media.video.analyze") {
    const path = resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS || "");
    const sampleFps = command.args.sampleFps === undefined ? undefined : Number(command.args.sampleFps);
    return result(command, "complete", "filesystem", await analyzeVideo(path, sampleFps === undefined ? {} : { sampleFps }));
  }
'@
$videoNew = @'
  if (command.action === "media.video.analyze") {
    const path = resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS || "");
    const sampleFps = command.args.sampleFps === undefined ? undefined : Number(command.args.sampleFps);
    const variant = { sampleFps: sampleFps ?? null };
    const output = await cachedMediaAnalysis("video", path, variant, () => analyzeVideo(path, sampleFps === undefined ? {} : { sampleFps }));
    return result(command, "complete", "filesystem", output);
  }
'@
if (-not $content.Contains($videoOld)) { throw 'Could not find media.video.analyze block.' }
$content = $content.Replace($videoOld, $videoNew)

$required = @(
  'FREEOS_MEDIA_ANALYSIS_CACHE_V1',
  'cachedMediaAnalysis("audio"',
  'cachedMediaAnalysis("video"',
  'stat.mtimeMs',
  '[FREEOS media cache] hit'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "Media cache upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Adobe worker media analysis cache installed.' -ForegroundColor Green
