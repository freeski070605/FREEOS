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
  "curriculum\skill-academy\marketing-content-growth-core-v1.json",
  "curriculum\skill-academy\sales-customer-service-core-v1.json",
  "curriculum\skill-academy\project-management-operations-core-v1.json",
  "curriculum\skill-academy\construction-trades-core-v1.json",
  "curriculum\skill-academy\automotive-diagnostics-maintenance-core-v1.json",
  "curriculum\skill-academy\music-audio-production-core-v1.json",
  "curriculum\skill-academy\game-3d-production-core-v1.json"
)

Write-Host "`n=== SKILL ACADEMY EXPANSION WAVE 2 ===" -ForegroundColor Cyan
Write-Host "1. Marketing, Content & Growth Core v1"
Write-Host "2. Sales & Customer Service Core v1"
Write-Host "3. Project Management & Operations Core v1"
Write-Host "4. Construction & Trades Core v1"
Write-Host "5. Automotive Diagnostics & Maintenance Core v1"
Write-Host "6. Music & Audio Production Core v1"
Write-Host "7. Game & 3D Production Core v1"
Write-Host "`nExpected expansion: 56 competencies, 168 training units, 56 drills." -ForegroundColor Yellow
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

& $importer -PackPath $packPaths -OwnerApproved:$OwnerApproved -BaseUrl $BaseUrl
