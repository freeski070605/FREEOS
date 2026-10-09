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
  "curriculum\skill-academy\data-analysis-spreadsheets-core-v1.json",
  "curriculum\skill-academy\cybersecurity-it-operations-core-v1.json",
  "curriculum\skill-academy\web-product-delivery-core-v1.json",
  "curriculum\skill-academy\logistics-transportation-dispatch-core-v1.json",
  "curriculum\skill-academy\entrepreneurship-market-research-core-v1.json"
)

Write-Host "`n=== SKILL ACADEMY EXPANSION WAVE 3 ===" -ForegroundColor Cyan
Write-Host "1. Data Analysis & Spreadsheets Core v1"
Write-Host "2. Cybersecurity & IT Operations Core v1"
Write-Host "3. Web & Product Delivery Core v1"
Write-Host "4. Logistics, Transportation & Dispatch Core v1"
Write-Host "5. Entrepreneurship & Market Research Core v1"
Write-Host "`nExpected expansion: 40 competencies, 120 training units, 40 drills." -ForegroundColor Yellow
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

& $importer -PackPath $packPaths -OwnerApproved:$OwnerApproved -BaseUrl $BaseUrl
