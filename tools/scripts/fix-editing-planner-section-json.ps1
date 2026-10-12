$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

$oldEvidence = @'
function sectionEvidence(audio: JsonObject, videos: JsonObject[], start: number, end: number) {
  const audioWindows = Array.isArray(audio.windows) ? audio.windows as JsonObject[] : [];
  return {
    start,
    end,
    audio: {
      tempo: audio.tempo,
      loudness: audio.loudness,
      sections: audio.sections,
      silenceRegions: audio.silenceRegions,
      windows: audioWindows.filter((w) => number(w.end, 0) > start && number(w.start, 0) < end),
    },
    clips: videos.map((video) => {
      const windows = Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
      return {
        id: video.id,
        timelineAvailableStart: video.timelineAvailableStart,
        timelineAvailableEnd: video.timelineAvailableEnd,
        summary: video.summary,
        qualityFlags: video.qualityFlags,
        windows: windows.filter((w) => number(w.timelineEnd, 0) > start && number(w.timelineStart, 0) < end),
      };
    }).filter((video) => number(video.timelineAvailableEnd, 0) > start && number(video.timelineAvailableStart, 0) < end),
  };
}
'@

$newEvidence = @'
function sectionEvidence(audio: JsonObject, videos: JsonObject[], start: number, end: number) {
  const audioWindows = Array.isArray(audio.windows) ? audio.windows as JsonObject[] : [];
  const sectionAudio = audioWindows.filter((w) => number(w.end, 0) > start && number(w.start, 0) < end);
  return {
    start,
    end,
    audio: {
      tempo: audio.tempo,
      loudness: audio.loudness,
      windows: sectionAudio.map((w) => ({
        start: w.start,
        end: w.end,
        energyMean: w.energyMean,
        transientCount: w.transientCount,
        strongestTransient: w.strongestTransient,
        beatCount: w.beatCount,
      })),
    },
    clips: videos.map((video) => {
      const windows = Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
      const sectionWindows = windows.filter((w) => number(w.timelineEnd, 0) > start && number(w.timelineStart, 0) < end);
      return {
        id: video.id,
        availableStart: video.timelineAvailableStart,
        availableEnd: video.timelineAvailableEnd,
        windows: sectionWindows.map((w) => ({
          start: w.timelineStart,
          end: w.timelineEnd,
          sharpness: w.sharpness,
          brightness: w.brightness,
          motion: w.motion,
          facePresence: w.facePresence,
          multiFacePresence: w.multiFacePresence,
          primaryFaceArea: w.primaryFaceArea,
          sceneChangeMax: w.sceneChangeMax,
          underexposedFraction: w.underexposedFraction,
          overexposedFraction: w.overexposedFraction,
        })),
      };
    }).filter((video) => number(video.availableEnd, 0) > start && number(video.availableStart, 0) < end),
  };
}
'@

if (-not $content.Contains($oldEvidence)) {
  throw 'Could not find sectionEvidence block. Repo may already be patched or changed.'
}
$content = $content.Replace($oldEvidence, $newEvidence)

$oldSystem = 'Required shape: {\"decisions\":[{\"start\":number,\"end\":number,\"clipId\":string,\"action\":\"cut|hold|punch-in\",\"confidence\":number,\"rationale\":string}],\"cautions\":[string]}. Decisions must be chronological, non-overlapping, and cover this section as completely as available evidence permits. Keep rationales short.`;'
$newSystem = 'Return ONLY the required object. The first top-level key must be \"decisions\". NEVER repeat, summarize, rename, or echo the supplied evidence. Do not output videoAnalysisResult, segments, clips, audio, reasoning, or markdown. Required shape: {\"decisions\":[{\"start\":number,\"end\":number,\"clipId\":string,\"action\":\"cut|hold|punch-in\",\"confidence\":number,\"rationale\":string}],\"cautions\":[string]}. Decisions must be chronological, non-overlapping, and cover this section as completely as available evidence permits. Keep rationales under 80 characters.`;'
if (-not $content.Contains($oldSystem)) {
  throw 'Could not find sectionSystem schema text.'
}
$content = $content.Replace($oldSystem, $newSystem)

$oldPredict = @'
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 150_000),
      numPredict: 1400,
      temperature: 0.3,
'@
$newPredict = @'
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 150_000),
      numPredict: 700,
      temperature: 0.2,
'@
if (-not $content.Contains($oldPredict)) {
  throw 'Could not find primary section generation settings.'
}
$content = $content.Replace($oldPredict, $newPredict)

$oldCatchCall = @'
      sectionText = await generateJson({
        system: `Return valid JSON only. Repair this section edit plan. Preserve its creative intent. Use only clip ids ${included.map((clip) => clip.id).join(", ")}. All decisions must stay within ${sectionStart}-${sectionEnd} absolute timeline seconds, be chronological and non-overlapping, and respect source availability. Required shape: {"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string]}.`,
        prompt: sectionText.slice(0, 8000),
        timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 90_000),
        numPredict: 1000,
        temperature: 0.1,
      });
'@
$newCatchCall = @'
      const availability = evidence.clips.map((clip) => ({
        id: clip.id,
        availableStart: clip.availableStart,
        availableEnd: clip.availableEnd,
      }));
      sectionText = await generateJson({
        system: `Return JSON only. Create a fresh section edit plan; do NOT repair or echo the previous malformed response. The first top-level key must be "decisions". Never output videoAnalysisResult, segments, clips, audio, analysis, markdown, or reasoning. Use only clip ids ${included.map((clip) => clip.id).join(", ")}. All decisions must stay within ${sectionStart}-${sectionEnd} absolute timeline seconds, be chronological, non-overlapping, and inside the supplied per-clip availability. Required shape: {"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string]}. Keep rationales under 80 characters.`,
        prompt: {
          sectionStart,
          sectionEnd,
          previousClipId: previousClipId || null,
          creativeBrief: brief,
          availability,
          evidence,
        },
        timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 90_000),
        numPredict: 650,
        temperature: 0.05,
      });
'@
if (-not $content.Contains($oldCatchCall)) {
  throw 'Could not find repair generation block.'
}
$content = $content.Replace($oldCatchCall, $newCatchCall)

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Patched staged planner to prevent evidence-echo JSON runaway.' -ForegroundColor Green
