$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if (-not $content.Contains('freeos-creative-planner-v5.3-global-review')) {
  throw 'Planner v5.3 global review must be installed before applying v5.3.1 diagnostics.'
}

$evidenceMarker = '    assemblyReviewApplied?: boolean;'
if (-not $content.Contains($evidenceMarker)) { throw 'Could not find assemblyReviewApplied evidence field.' }
if (-not $content.Contains('assemblyReviewFailure?: string;')) {
  $content = $content.Replace($evidenceMarker, $evidenceMarker + "`r`n    assemblyReviewFailure?: string;")
}

$initMarker = '  let assemblyReviewApplied = false;'
if (-not $content.Contains($initMarker)) { throw 'Could not find assembly review initialization.' }
if (-not $content.Contains('let assemblyReviewFailure: string | undefined;')) {
  $content = $content.Replace($initMarker, $initMarker + "`r`n  let assemblyReviewFailure: string | undefined;")
}

$catchOld = @'
  } catch (error) {
    console.error(`[FREEOS Editing Planner] global assembly review failed; preserving valid staged draft: ${error instanceof Error ? error.message : String(error)}`);
  }
'@
$catchNew = @'
  } catch (error) {
    assemblyReviewFailure = error instanceof Error ? error.message : String(error);
    console.error(`[FREEOS Editing Planner] global assembly review failed; preserving valid staged draft: ${assemblyReviewFailure}`);
  }
'@
if ($content.Contains($catchOld)) {
  $content = $content.Replace($catchOld, $catchNew)
} elseif (-not $content.Contains('assemblyReviewFailure = error instanceof Error ? error.message : String(error);')) {
  throw 'Could not patch assembly review catch block.'
}

$returnMarker = '      assemblyReviewApplied,'
if (-not $content.Contains($returnMarker)) { throw 'Could not find assemblyReviewApplied return field.' }
if (-not $content.Contains('      assemblyReviewFailure,')) {
  $content = $content.Replace($returnMarker, $returnMarker + "`r`n      assemblyReviewFailure,")
}

$content = $content.Replace('version: "freeos-creative-planner-v5.3-global-review"', 'version: "freeos-creative-planner-v5.3.1-review-diagnostics"')

$required = @(
  'assemblyReviewFailure?: string;',
  'let assemblyReviewFailure: string | undefined;',
  'assemblyReviewFailure = error instanceof Error ? error.message : String(error);',
  'assemblyReviewFailure,',
  'freeos-creative-planner-v5.3.1-review-diagnostics'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.3.1 diagnostics upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.3.1 review diagnostics.' -ForegroundColor Green
