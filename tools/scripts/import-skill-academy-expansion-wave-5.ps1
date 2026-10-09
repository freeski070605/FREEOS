param(
  [switch]$OwnerApproved,
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$importer = Join-Path $root "tools\scripts\import-skill-teaching-pack.ps1"
if (-not (Test-Path -LiteralPath $importer -PathType Leaf)) {
  throw "Generic teaching-pack importer not found: $importer"
}

$packPaths = @(
  "curriculum\skill-academy\adobe-premiere-pro-advanced-core-v1.json",
  "curriculum\skill-academy\adobe-after-effects-advanced-core-v1.json",
  "curriculum\skill-academy\adobe-photoshop-lightroom-core-v1.json",
  "curriculum\skill-academy\color-grading-davinci-resolve-core-v1.json",
  "curriculum\skill-academy\daw-music-production-workflows-core-v1.json",
  "curriculum\skill-academy\windows-powershell-vscode-operations-core-v1.json",
  "curriculum\skill-academy\containers-development-environments-core-v1.json",
  "curriculum\skill-academy\database-sql-operations-core-v1.json",
  "curriculum\skill-academy\ai-model-training-inference-operations-core-v1.json"
)

Write-Host "`n=== SKILL ACADEMY EXPANSION WAVE 5 ===" -ForegroundColor Cyan
Write-Host "1. Adobe Premiere Pro Advanced Core v1"
Write-Host "2. Adobe After Effects Advanced Core v1"
Write-Host "3. Adobe Photoshop & Lightroom Production Core v1"
Write-Host "4. Color Science & DaVinci Resolve Core v1"
Write-Host "5. DAW Music Production Workflows Core v1"
Write-Host "6. Windows, PowerShell & VS Code Operations Core v1"
Write-Host "7. Containers & Development Environments Core v1"
Write-Host "8. Database & SQL Operations Core v1"
Write-Host "9. AI Model Training & Inference Operations Core v1"
Write-Host "`nExpected expansion: 72 competencies, 216 training units, 72 drills." -ForegroundColor Yellow
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

& $importer -PackPath $packPaths -OwnerApproved:$OwnerApproved -BaseUrl $BaseUrl
