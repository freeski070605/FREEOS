$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.5.2-safe-review-commit')) {
  Write-Host '[FREEOS] Editing Planner v5.5.2 safe review commit is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.5.1-authoritative-closing')) {
  throw 'Planner v5.5.1 authoritative closing must be installed before applying v5.5.2.'
}

$firstOld = @'
    reviewedDecisions = validateAssemblyReview(parsedAssembly, allowedClipIds, availableEnd, videos);
    assertNonDegenerateAssembly(reviewedDecisions, decisions);
    assemblyReviewApplied = true;
'@
$firstNew = @'
    const assemblyCandidate = validateAssemblyReview(parsedAssembly, allowedClipIds, availableEnd, videos);
    assertNonDegenerateAssembly(assemblyCandidate, decisions);
    reviewedDecisions = assemblyCandidate;
    assemblyReviewApplied = true;
'@
if (-not $content.Contains($firstOld)) { throw 'Could not find first global-review acceptance block.' }
$content = $content.Replace($firstOld, $firstNew)

$repairOld = @'
      reviewedDecisions = validateAssemblyReview(parsedRepair, allowedClipIds, availableEnd, videos);
      assertNonDegenerateAssembly(reviewedDecisions, decisions);
      assemblyReviewApplied = true;
'@
$repairNew = @'
      const repairCandidate = validateAssemblyReview(parsedRepair, allowedClipIds, availableEnd, videos);
      assertNonDegenerateAssembly(repairCandidate, decisions);
      reviewedDecisions = repairCandidate;
      assemblyReviewApplied = true;
'@
if (-not $content.Contains($repairOld)) { throw 'Could not find constrained-repair acceptance block.' }
$content = $content.Replace($repairOld, $repairNew)

$content = $content.Replace('version: "freeos-creative-planner-v5.5.1-authoritative-closing"', 'version: "freeos-creative-planner-v5.5.2-safe-review-commit"')

$required = @(
  'const assemblyCandidate = validateAssemblyReview(',
  'assertNonDegenerateAssembly(assemblyCandidate, decisions);',
  'reviewedDecisions = assemblyCandidate;',
  'const repairCandidate = validateAssemblyReview(',
  'assertNonDegenerateAssembly(repairCandidate, decisions);',
  'reviewedDecisions = repairCandidate;',
  'freeos-creative-planner-v5.5.2-safe-review-commit'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.5.2 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.5.2 safe review commit.' -ForegroundColor Green
