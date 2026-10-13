$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

$old = 'assemblyReviewFailure = null;'
$new = 'assemblyReviewFailure = undefined;'

if (-not $content.Contains($old)) {
  if ($content.Contains($new)) {
    Write-Host '[FREEOS] v5.3.2 assemblyReviewFailure type repair is already installed.' -ForegroundColor Yellow
    exit 0
  }
  throw 'Could not find the v5.3.2 assemblyReviewFailure reset assignment.'
}

$content = $content.Replace($old, $new)
Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Fixed v5.3.2 assemblyReviewFailure reset to use undefined.' -ForegroundColor Green
