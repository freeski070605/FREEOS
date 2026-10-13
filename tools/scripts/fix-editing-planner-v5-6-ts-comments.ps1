$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

$old1 = '      # Removing a switch means the preceding shot continues through the removed segment.'
$old2 = '      # Reject that removal deterministically if the preceding source cannot cover it.'
$new1 = '      // Removing a switch means the preceding shot continues through the removed segment.'
$new2 = '      // Reject that removal deterministically if the preceding source cannot cover it.'

$changed = $false
if ($content.Contains($old1)) {
  $content = $content.Replace($old1, $new1)
  $changed = $true
}
if ($content.Contains($old2)) {
  $content = $content.Replace($old2, $new2)
  $changed = $true
}

if (-not $changed) {
  Write-Host '[FREEOS] v5.6 TypeScript comments were already fixed or the expected lines were not present.' -ForegroundColor Yellow
  exit 0
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Fixed v5.6 TypeScript comments.' -ForegroundColor Green
