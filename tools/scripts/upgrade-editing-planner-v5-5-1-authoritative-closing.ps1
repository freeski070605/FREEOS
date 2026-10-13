$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.5.1-authoritative-closing')) {
  Write-Host '[FREEOS] Editing Planner v5.5.1 authoritative closing is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.5-explicit-closing')) {
  throw 'Planner v5.5 explicit closing must be installed before applying v5.5.1.'
}

$old = @'
  const earlier = raw.switches.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    return number((item as JsonObject).at, NaN) < closingAt - 0.001;
  });
  if (earlier.length !== raw.switches.length) throw new Error('Assembly review contains a regular switch at or after the required closing switch.');

  const allSwitches = [...earlier, {
'@

$new = @'
  // The explicit closing is authoritative. Any ordinary switch at the same
  // timestamp or later is redundant/conflicting output from the model and is
  // discarded deterministically before validation. This does not make a new
  // creative choice; it enforces the review schema's closing contract.
  const earlier = raw.switches.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    return number((item as JsonObject).at, NaN) < closingAt - 0.001;
  });

  const allSwitches = [...earlier, {
'@

if (-not $content.Contains($old)) {
  throw 'Could not find v5.5 closing conflict block.'
}

$content = $content.Replace($old, $new)
$content = $content.Replace('version: "freeos-creative-planner-v5.5-explicit-closing"', 'version: "freeos-creative-planner-v5.5.1-authoritative-closing"')

$required = @(
  'The explicit closing is authoritative.',
  'return number((item as JsonObject).at, NaN) < closingAt - 0.001;',
  'freeos-creative-planner-v5.5.1-authoritative-closing'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.5.1 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.5.1 authoritative source-safe closing.' -ForegroundColor Green
