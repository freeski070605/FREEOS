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
  "curriculum\skill-academy\procurement-vendor-management-core-v1.json",
  "curriculum\skill-academy\hr-people-operations-core-v1.json",
  "curriculum\skill-academy\ecommerce-digital-merchandising-core-v1.json",
  "curriculum\skill-academy\event-production-live-operations-core-v1.json",
  "curriculum\skill-academy\property-real-estate-operations-core-v1.json",
  "curriculum\skill-academy\cloud-dns-web-infrastructure-core-v1.json",
  "curriculum\skill-academy\streaming-broadcast-creator-distribution-core-v1.json",
  "curriculum\skill-academy\bookkeeping-payroll-financial-operations-core-v1.json"
)

Write-Host "`n=== SKILL ACADEMY EXPANSION WAVE 6 ===" -ForegroundColor Cyan
Write-Host "1. Procurement & Vendor Management Core v1"
Write-Host "2. HR & People Operations Core v1"
Write-Host "3. E-commerce & Digital Merchandising Core v1"
Write-Host "4. Event Production & Live Operations Core v1"
Write-Host "5. Property & Real Estate Operations Core v1"
Write-Host "6. Cloud, DNS & Web Infrastructure Core v1"
Write-Host "7. Streaming, Broadcast & Creator Distribution Core v1"
Write-Host "8. Bookkeeping, Payroll & Financial Operations Core v1"
Write-Host "`nExpected expansion: 64 competencies, 192 training units, 64 drills." -ForegroundColor Yellow
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

& $importer -PackPath $packPaths -OwnerApproved:$OwnerApproved -BaseUrl $BaseUrl
