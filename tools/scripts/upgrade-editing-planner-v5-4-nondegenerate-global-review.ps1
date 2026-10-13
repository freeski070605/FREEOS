$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.4-nondegenerate-review')) {
  Write-Host '[FREEOS] Editing Planner v5.4 nondegenerate review is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.3.3-compact-review')) {
  throw 'Planner v5.3.3 compact review must be installed before applying v5.4.'
}

$insertMarker = 'function buildGroundedCautions('
$insertPos = $content.IndexOf($insertMarker)
if ($insertPos -lt 0) { throw 'Could not find grounded caution helper.' }

if (-not $content.Contains('function assertNonDegenerateAssembly(')) {
  $guard = @'
function assertNonDegenerateAssembly(reviewed: EditingDecision[], draft: EditingDecision[]): void {
  if (!reviewed.length || !draft.length) return;
  const reviewedStart = reviewed[0].start;
  const reviewedEnd = reviewed.at(-1)?.end ?? reviewedStart;
  const reviewedDuration = Math.max(0.001, reviewedEnd - reviewedStart);
  const draftStart = draft[0].start;
  const draftEnd = draft.at(-1)?.end ?? draftStart;
  const draftDuration = Math.max(0.001, draftEnd - draftStart);

  const coverage = (items: EditingDecision[]) => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.clipId, (map.get(item.clipId) ?? 0) + Math.max(0, item.end - item.start));
    return map;
  };

  const reviewedCoverage = coverage(reviewed);
  const draftCoverage = coverage(draft);
  const reviewedDominant = Math.max(...reviewedCoverage.values()) / reviewedDuration;
  const draftDominant = Math.max(...draftCoverage.values()) / draftDuration;
  const reviewedUnique = reviewedCoverage.size;
  const draftUnique = draftCoverage.size;

  const severeDominance = reviewedDominant >= 0.88 && reviewedDominant >= draftDominant + 0.18;
  const severeVarietyCollapse = draftUnique >= 4 && reviewedUnique <= 2 && reviewed.length <= 4;

  if (severeDominance || severeVarietyCollapse) {
    throw new Error(`Global assembly review over-collapsed the staged edit (dominantShare=${reviewedDominant.toFixed(3)}, draftDominantShare=${draftDominant.toFixed(3)}, reviewedCameras=${reviewedUnique}, draftCameras=${draftUnique}, reviewedSegments=${reviewed.length}). Preserve motivated camera variety while removing only unsupported boundary artifacts.`);
  }
}

'@
  $content = $content.Substring(0, $insertPos) + $guard + $content.Substring($insertPos)
}

# Validate the first global review for pathological collapse before accepting it.
$firstAccept = @'
    reviewedDecisions = validateSectionSwitches(parsedAssembly.opening, parsedAssembly.switches, allowedClipIds, 0, availableEnd, videos);
    assemblyReviewApplied = true;
'@
if (-not $content.Contains($firstAccept)) { throw 'Could not find first global review acceptance block.' }
$content = $content.Replace($firstAccept, @'
    reviewedDecisions = validateSectionSwitches(parsedAssembly.opening, parsedAssembly.switches, allowedClipIds, 0, availableEnd, videos);
    assertNonDegenerateAssembly(reviewedDecisions, decisions);
    assemblyReviewApplied = true;
'@)

# Validate the constrained repair too.
$repairAccept = @'
      reviewedDecisions = validateSectionSwitches(parsedRepair.opening, parsedRepair.switches, allowedClipIds, 0, availableEnd, videos);
      assemblyReviewApplied = true;
'@
if (-not $content.Contains($repairAccept)) { throw 'Could not find constrained repair acceptance block.' }
$content = $content.Replace($repairAccept, @'
      reviewedDecisions = validateSectionSwitches(parsedRepair.opening, parsedRepair.switches, allowedClipIds, 0, availableEnd, videos);
      assertNonDegenerateAssembly(reviewedDecisions, decisions);
      assemblyReviewApplied = true;
'@)

# Make both finishing prompts explicitly surgical rather than whole-edit simplification.
$assemblyPhrase = 'Remove boundary-driven switch bursts, redundant same-purpose cuts, and switches that exist only because a section ended.'
if ($content.Contains($assemblyPhrase)) {
  $content = $content.Replace($assemblyPhrase, $assemblyPhrase + ' Make those fixes surgically: do not simplify the entire piece into one dominant camera merely to remove boundary artifacts. Preserve motivated camera variety and meaningful shot-role changes from the staged draft when supported by evidence.')
}

$repairPhrase = 'Remove boundary-driven bursts and redundant switches.'
if ($content.Contains($repairPhrase)) {
  $content = $content.Replace($repairPhrase, $repairPhrase + ' Do not over-correct by collapsing most of the runtime onto one camera. Preserve motivated camera variety from the staged draft while fixing the exact validation failure.')
}

$content = $content.Replace('version: "freeos-creative-planner-v5.3.3-compact-review"', 'version: "freeos-creative-planner-v5.4-nondegenerate-review"')

$required = @(
  'function assertNonDegenerateAssembly(',
  'assertNonDegenerateAssembly(reviewedDecisions, decisions);',
  'over-collapsed the staged edit',
  'do not simplify the entire piece into one dominant camera',
  'freeos-creative-planner-v5.4-nondegenerate-review'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.4 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.4 nondegenerate global review.' -ForegroundColor Green
