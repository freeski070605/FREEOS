$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.6-boundary-prune-review')) {
  Write-Host '[FREEOS] Editing Planner v5.6 boundary-prune review is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.5.2-safe-review-commit')) {
  throw 'Planner v5.5.2 safe review commit must be installed before applying v5.6.'
}

# Extend evidence contract so the caller can verify the surgical review actually ran.
$evidenceMarker = '    assemblyReviewFailure?: string;'
if ($content.Contains($evidenceMarker) -and -not $content.Contains('assemblyBoundaryPrunes?: number;')) {
  $content = $content.Replace($evidenceMarker, $evidenceMarker + "`r`n    assemblyBoundaryPrunes?: number;")
}

# Add a compact schema that can only remove existing draft switchpoints near internal planning boundaries.
$schemaMarker = 'function buildSectionPlanSchema('
$schemaPos = $content.IndexOf($schemaMarker)
if ($schemaPos -lt 0) { throw 'Could not find section schema builder.' }
if (-not $content.Contains('function buildBoundaryPruneSchema(')) {
  $schema = @'
function buildBoundaryPruneSchema(candidateTimes: number[]): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["removeSwitches"],
    properties: {
      removeSwitches: {
        type: "array",
        uniqueItems: true,
        maxItems: candidateTimes.length,
        items: candidateTimes.length
          ? { type: "number", enum: candidateTimes }
          : { type: "number", enum: [] },
      },
    },
  };
}

'@
  $content = $content.Substring(0, $schemaPos) + $schema + $content.Substring($schemaPos)
}

# Replace the full-timeline regeneration review with a surgical prune-only review.
$startMarker = '  const boundaryContexts = [48, 96, 144]'
$endMarker = '  const normalizedDecisions: EditingDecision[] = [];'
$start = $content.IndexOf($startMarker)
$end = $content.IndexOf($endMarker, $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Could not locate existing global assembly review block.' }

$newBlock = @'
  const internalBoundaries = [48, 96, 144].filter((boundary) => boundary > 0 && boundary < availableEnd);
  const boundaryContexts = internalBoundaries.map((boundary) => ({
    boundary,
    context: sectionEvidence(audio, videos, Math.max(0, boundary - 8), Math.min(availableEnd, boundary + 8)),
  }));

  let assemblyReviewApplied = false;
  let assemblyReviewFailure: string | undefined;
  let assemblyBoundaryPrunes = 0;
  let reviewedDecisions = decisions.map((decision) => ({ ...decision }));

  try {
    const candidateSwitches = decisions
      .slice(1)
      .filter((decision) => internalBoundaries.some((boundary) => Math.abs(decision.start - boundary) <= 6.001))
      .map((decision) => Number(decision.start.toFixed(3)));

    const uniqueCandidateTimes = Array.from(new Set(candidateSwitches)).sort((a, b) => a - b);
    const candidateDetails = uniqueCandidateTimes.map((at) => {
      const index = decisions.findIndex((decision) => Math.abs(decision.start - at) <= 0.001);
      return {
        at,
        before: index > 0 ? decisions[index - 1] : null,
        after: index >= 0 ? decisions[index] : null,
        nearestBoundary: internalBoundaries.reduce((best, boundary) => Math.abs(boundary - at) < Math.abs(best - at) ? boundary : best, internalBoundaries[0] ?? at),
      };
    });

    const pruneSystem = `You are FREEOS's senior finishing editor performing a SURGICAL boundary cleanup on an already-valid multicam draft. You may only remove existing switchpoints listed in candidateSwitches. The 48/96/144-second boundaries are internal planning artifacts, not creative events. Remove a candidate switch only when it looks like a boundary-driven burst, redundant handoff, or section-end artifact. Do not redesign the whole edit, do not add switchpoints, do not change cameras elsewhere, and do not remove motivated short bursts merely because they are short. Returning an empty removeSwitches array is valid. Camera profiles describe visual character, not rankings.`;

    const pruneText = await generateJson({
      system: pruneSystem,
      prompt: {
        userIntent: intent,
        creativeBrief: brief,
        cameraProfiles,
        candidateSwitches: candidateDetails,
        boundaryContexts,
        draftDecisions: decisions,
      },
      schema: buildBoundaryPruneSchema(uniqueCandidateTimes),
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 120_000),
      numPredict: 900,
      temperature: 0.08,
    });

    const parsedPrune = asObject(JSON.parse(pruneText), "boundary prune response");
    const requestedRemovals = Array.isArray(parsedPrune.removeSwitches)
      ? parsedPrune.removeSwitches.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : [];
    const allowedRemovalTimes = new Set(uniqueCandidateTimes.map((value) => value.toFixed(3)));

    for (const requestedAt of requestedRemovals.sort((a, b) => a - b)) {
      const at = Number(requestedAt.toFixed(3));
      if (!allowedRemovalTimes.has(at.toFixed(3))) continue;
      const index = reviewedDecisions.findIndex((decision) => Math.abs(decision.start - at) <= 0.001);
      if (index <= 0) continue;

      const previous = reviewedDecisions[index - 1];
      const current = reviewedDecisions[index];
      const previousVideo = videos.find((video) => String(video.id) === previous.clipId);
      const availableEndForPrevious = number(previousVideo?.timelineAvailableEnd, 0);

      # Removing a switch means the preceding shot continues through the removed segment.
      # Reject that removal deterministically if the preceding source cannot cover it.
      if (!previousVideo || current.end > availableEndForPrevious + 0.05) continue;

      previous.end = current.end;
      previous.confidence = Math.min(previous.confidence, current.confidence);
      reviewedDecisions.splice(index, 1);
      assemblyBoundaryPrunes += 1;
    }

    assertNonDegenerateAssembly(reviewedDecisions, decisions);
    assemblyReviewApplied = true;
    assemblyReviewFailure = undefined;
  } catch (error) {
    assemblyReviewFailure = error instanceof Error ? error.message : String(error);
    reviewedDecisions = decisions.map((decision) => ({ ...decision }));
    assemblyBoundaryPrunes = 0;
    console.error(`[FREEOS Editing Planner] surgical boundary review failed; preserving valid staged draft: ${assemblyReviewFailure}`);
  }

'@

$content = $content.Substring(0, $start) + $newBlock + $content.Substring($end)

# Bump identity/mode and expose prune count.
$content = $content.Replace('version: "freeos-creative-planner-v5.5.2-safe-review-commit"', 'version: "freeos-creative-planner-v5.6-boundary-prune-review"')
$content = $content.Replace('plannerMode: "academy-guided-camera-profile-global-review"', 'plannerMode: "academy-guided-camera-profile-boundary-prune-review"')

$evidenceReturn = '      assemblyReviewApplied,'
if (-not $content.Contains($evidenceReturn)) { throw 'Could not find assembly review evidence return.' }
if (-not $content.Contains('      assemblyBoundaryPrunes,')) {
  $content = $content.Replace($evidenceReturn, $evidenceReturn + "`r`n      assemblyBoundaryPrunes,")
}

$required = @(
  'function buildBoundaryPruneSchema(',
  'SURGICAL boundary cleanup',
  'candidateSwitches: candidateDetails',
  'assemblyBoundaryPrunes += 1;',
  'freeos-creative-planner-v5.6-boundary-prune-review',
  'academy-guided-camera-profile-boundary-prune-review'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.6 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.6 surgical boundary-prune review.' -ForegroundColor Green
