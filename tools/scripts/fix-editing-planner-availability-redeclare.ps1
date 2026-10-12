$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$lines = Get-Content -LiteralPath $path

$matches = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*const availability = ') { $matches += $i }
}

if ($matches.Count -lt 2) {
  Write-Host '[FREEOS] No duplicate availability declaration found; nothing to fix.' -ForegroundColor Yellow
  exit 0
}

$second = $matches[1]
$lines[$second] = $lines[$second] -replace 'const availability =', 'const retryAvailability ='

$updatedUsage = $false
for ($i = $second + 1; $i -lt [Math]::Min($lines.Count, $second + 40); $i++) {
  if ($lines[$i] -match '^\s*availability,\s*$') {
    $indent = ($lines[$i] -replace '(\S.*)$','')
    $lines[$i] = $indent + 'availability: retryAvailability,'
    $updatedUsage = $true
    break
  }
}

if (-not $updatedUsage) {
  throw 'Renamed the duplicate declaration but could not find its prompt usage nearby.'
}

Set-Content -LiteralPath $path -Value $lines -Encoding UTF8
Write-Host '[FREEOS] Fixed duplicate availability declaration.' -ForegroundColor Green
