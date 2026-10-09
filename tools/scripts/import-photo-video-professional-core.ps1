param(
  [switch]$OwnerApproved,
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$packPath = Join-Path $root "curriculum\skill-academy\photo-video-professional-core-v1.json"
if (-not (Test-Path -LiteralPath $packPath -PathType Leaf)) {
  throw "Teaching pack not found: $packPath"
}

$pack = Get-Content -LiteralPath $packPath -Raw | ConvertFrom-Json
$pack | Add-Member -NotePropertyName ownerApproved -NotePropertyValue ([bool]$OwnerApproved) -Force

Write-Host "`n=== PHOTO / VIDEO TEACHING PACK ===" -ForegroundColor Cyan
Write-Host "Pack:        $($pack.title)"
Write-Host "Competencies: $(@($pack.competencies).Count)"
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

$unitCount = 0
$drillCount = 0
foreach ($competency in @($pack.competencies)) {
  $unitCount += @($competency.units).Count
  $drillCount += @($competency.drills).Count
}
Write-Host "Training units: $unitCount"
Write-Host "Drills:         $drillCount"

if (@($pack.competencies).Count -ne 14) { throw "Expected 14 photo/video competencies in the core pack." }
if ($unitCount -lt 42) { throw "Expected at least 42 training units in the core pack." }
if ($drillCount -lt 14) { throw "Expected at least 14 drills in the core pack." }

if (-not $OwnerApproved) {
  Write-Host "`n=== PREVIEW ONLY ===" -ForegroundColor Yellow
  Write-Host "No active training material will be created without explicit owner approval." -ForegroundColor Yellow
  Write-Host "Re-run this same script with -OwnerApproved after Drew approves the pack." -ForegroundColor Yellow
  @($pack.competencies) |
    Select-Object key,name,@{Name='units';Expression={@($_.units).Count}},@{Name='drills';Expression={@($_.drills).Count}} |
    Format-Table -AutoSize
  exit 0
}

Write-Host "`n=== IMPORT OWNER-APPROVED TEACHING PACK ===" -ForegroundColor Cyan
$body = $pack | ConvertTo-Json -Depth 64
$result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/skill-academy/teaching-packs/import" -ContentType "application/json" -Body $body
$result | Format-List

if ($result.approvalStatus -ne "owner-approved") { throw "Teaching pack was not recorded as owner-approved." }
if ($result.trainingMaterialStatus -ne "active") { throw "Teaching pack units were not activated." }
if ([int]$result.importedCompetencies -ne 14) { throw "Unexpected competency import count." }
if ([int]$result.importedUnits -lt 42) { throw "Unexpected training-unit import count." }
if ([int]$result.importedDrills -lt 14) { throw "Unexpected drill import count." }
if ($result.masteryChanged -ne $false) { throw "Teaching import incorrectly changed mastery." }

Write-Host "`n=== VERIFY PHOTO / VIDEO CATALOG ===" -ForegroundColor Cyan
$catalog = Invoke-RestMethod -Method Get -Uri "$BaseUrl/skill-academy/catalog?domainKey=photo-video"
$domain = @($catalog.domains | Select-Object -First 1)
if ($domain.Count -ne 1) { throw "Photo/video domain was not returned after import." }

@($domain[0].competencies) |
  Select-Object competencyKey,name,masteryLevel,masteryScore,activeUnits,activeDrills |
  Format-Table -AutoSize

$notTheory = @($domain[0].competencies | Where-Object { $_.masteryLevel -ne "theory" })
if ($notTheory.Count -ne 0) { throw "Teaching material incorrectly advanced mastery before practice." }

$missingUnits = @($domain[0].competencies | Where-Object { [int]$_.activeUnits -lt 3 })
if ($missingUnits.Count -ne 0) { throw "One or more photo/video competencies did not receive the expected active training material." }

Write-Host "`nProfessional Photo & Video Production Core v1 import complete." -ForegroundColor Green
Write-Host "FREEOS now has active practical instruction and drills across all 14 photo/video competencies." -ForegroundColor Green
Write-Host "Mastery remains THEORY until evaluated practice demonstrates ability." -ForegroundColor Green
