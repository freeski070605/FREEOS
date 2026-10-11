$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$path = Join-Path $repo "apps/api-server/src/services/editingPlanner.service.ts"
$text = Get-Content -LiteralPath $path -Raw

$old = @'
    let sectionDecisions: EditingDecision[];
    try {
      sectionDecisions = parseSectionDecisions(sectionText, allowedClipIds, sectionStart, sectionEnd, videos);
    } catch (error) {
      console.error(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} response excerpt:`, sectionText.slice(0, 1600));
      sectionText = await generateJson({
        system: `Return valid JSON only. Repair this section edit plan. Preserve its creative intent. Use only clip ids ${included.map((clip) => clip.id).join(", ")}. All decisions must stay within ${sectionStart}-${sectionEnd} absolute timeline seconds, be chronological and non-overlapping, and respect source availability. Required shape: {"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string]}.`,
        prompt: sectionText.slice(0, 8000),
        timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 90_000),
        numPredict: 1000,
        temperature: 0.1,
      });
      sectionDecisions = parseSectionDecisions(sectionText, allowedClipIds, sectionStart, sectionEnd, videos);
    }
'@

$new = @'
    let sectionDecisions: EditingDecision[];
    try {
      sectionDecisions = parseSectionDecisions(sectionText, allowedClipIds, sectionStart, sectionEnd, videos);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      const availability = videos
        .map((video) => ({
          clipId: String(video.id),
          start: number(video.timelineAvailableStart, 0),
          end: number(video.timelineAvailableEnd, 0),
        }))
        .filter((video) => video.end > sectionStart && video.start < sectionEnd);
      console.error(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} parse failure: ${failure}`);
      console.error(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} response excerpt:`, sectionText.slice(0, 1600));
      sectionText = await generateJson({
        system: `Return valid JSON only. Repair this section edit plan without changing its creative intent more than necessary. The previous candidate failed validation because: ${failure}. Section bounds are ${sectionStart}-${sectionEnd} absolute timeline seconds. Every decision must stay inside both the section bounds AND the selected clip's exact availability range. Do not extend a clip earlier or later than its range. If the first part of the section is not covered by a desired clip, choose another actually available clip for that interval. Use only supplied clip ids. Keep decisions chronological and non-overlapping. Required shape: {"decisions":[{"start":number,"end":number,"clipId":string,"action":"cut|hold|punch-in","confidence":number,"rationale":string}],"cautions":[string]}.`,
        prompt: {
          invalidCandidate: sectionText.slice(0, 8000),
          exactClipAvailability: availability,
          sectionEvidence: evidence,
          previousClipId: previousClipId || null,
        },
        timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 90_000),
        numPredict: 1000,
        temperature: 0.1,
      });
      sectionDecisions = parseSectionDecisions(sectionText, allowedClipIds, sectionStart, sectionEnd, videos);
    }
'@

if (-not $text.Contains($old)) {
  throw "Expected staged-planner block was not found. The source may already be patched or changed."
}

$text = $text.Replace($old, $new)
Set-Content -LiteralPath $path -Value $text -Encoding UTF8
Write-Host "[FREEOS] Patched staged planner repair with exact clip availability." -ForegroundColor Green
Write-Host "[FREEOS] Updated: $path"
