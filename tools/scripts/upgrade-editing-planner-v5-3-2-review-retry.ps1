$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.3.2-review-retry')) {
  Write-Host '[FREEOS] Editing Planner v5.3.2 review retry is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.3.1-review-diagnostics')) {
  throw 'Planner v5.3.1 review diagnostics must be installed before applying v5.3.2 review retry.'
}

$old = @'
  } catch (error) {
    assemblyReviewFailure = error instanceof Error ? error.message : String(error);
    console.error(`[FREEOS Editing Planner] global assembly review failed; preserving valid staged draft: ${assemblyReviewFailure}`);
  }
'@

if (-not $content.Contains($old)) {
  throw 'Could not find v5.3.1 global review catch block.'
}

$new = @'
  } catch (error) {
    assemblyReviewFailure = error instanceof Error ? error.message : String(error);
    console.error(`[FREEOS Editing Planner] global assembly review failed; attempting one constrained repair: ${assemblyReviewFailure}`);

    try {
      const repairSystem = `You are FREEOS's senior finishing editor repairing one invalid whole-assembly review. Return a complete chronological opening plus later switchpoints for 0 to ${availableEnd.toFixed(3)} seconds. The previous review failed because a selected clip remained on screen past its source availability. Fix that exact problem while preserving the strongest global edit. Every chosen clip must remain available from its switchpoint until the NEXT switchpoint, and the final chosen clip must remain available through ${availableEnd.toFixed(3)}. If a clip ends before the assembly end, switch away from it BEFORE its available end. The 48/96/144-second boundaries are internal planning artifacts, not creative events. Remove boundary-driven bursts and redundant switches. Do not invent lyrics, fades, dissolves, detected cuts, overlapping audio, performer identity, audience behavior, or unseen events.`;
      const repairText = await generateJson({
        system: repairSystem,
        prompt: {
          previousFailure: assemblyReviewFailure,
          userIntent: intent,
          creativeBrief: brief,
          cameraProfiles,
          draftDecisions: decisions,
          availability: videos.map((video) => ({ id: video.id, start: video.timelineAvailableStart, end: video.timelineAvailableEnd })),
          boundaryContexts,
          audioOverview: {
            tempo: audio.tempo,
            loudness: audio.loudness,
            silences: audio.silences,
          },
        },
        schema: buildAssemblyReviewSchema(availableEnd, videos),
        timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000),
        numPredict: 2600,
        temperature: 0.05,
      });
      const parsedRepair = parseSectionPlan(repairText);
      reviewedDecisions = validateSectionSwitches(parsedRepair.opening, parsedRepair.switches, allowedClipIds, 0, availableEnd, videos);
      assemblyReviewApplied = true;
      assemblyReviewFailure = null;
    } catch (repairError) {
      assemblyReviewFailure = repairError instanceof Error ? repairError.message : String(repairError);
      console.error(`[FREEOS Editing Planner] constrained assembly repair failed; preserving valid staged draft: ${assemblyReviewFailure}`);
    }
  }
'@

$content = $content.Replace($old, $new)
$content = $content.Replace('version: "freeos-creative-planner-v5.3.1-review-diagnostics"', 'version: "freeos-creative-planner-v5.3.2-review-retry"')

$required = @(
  'attempting one constrained repair',
  'constrained assembly repair failed',
  'the final chosen clip must remain available through',
  'freeos-creative-planner-v5.3.2-review-retry'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.3.2 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.3.2 constrained global-review retry.' -ForegroundColor Green
