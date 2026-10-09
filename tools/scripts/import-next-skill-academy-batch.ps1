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
  "curriculum\skill-academy\photo-video-post-production-core-v1.json",
  "curriculum\skill-academy\design-ux-branding-core-v1.json",
  "curriculum\skill-academy\facilities-maintenance-core-v1.json"
)

Write-Host "`n=== NEXT SKILL ACADEMY TEACHING BATCH ===" -ForegroundColor Cyan
Write-Host "1. Photo & Video Post-Production Core v1"
Write-Host "2. Design, UX & Branding Core v1"
Write-Host "3. Facilities, Repair & Maintenance Core v1"
Write-Host "`nThis batch adds 30 competencies, 90 training units, and 30 drills." -ForegroundColor Yellow
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

& $importer -PackPath $packPaths -OwnerApproved:$OwnerApproved -BaseUrl $BaseUrl
