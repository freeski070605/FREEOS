param(
  [Parameter(Mandatory = $true)][string]$PackPath,
  [switch]$OwnerApproved,
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resolvedPackPath = if ([System.IO.Path]::IsPathRooted($PackPath)) { $PackPath } else { Join-Path $root $PackPath }
if (-not (Test-Path -LiteralPath $resolvedPackPath -PathType Leaf)) {
  throw "Teaching pack not found: $resolvedPackPath"
}

$pack = Get-Content -LiteralPath $resolvedPackPath -Raw | ConvertFrom-Json
$pack | Add-Member -NotePropertyName ownerApproved -NotePropertyValue ([bool]$OwnerApproved) -Force

$competencies = @($pack.competencies)
$unitCount = 0
$drillCount = 0
foreach ($competency in $competencies) {
  $unitCount += @($competency.units).Count
  $drillCount += @($competency.drills).Count
}

Write-Host "`n=== SKILL TEACHING PACK ===" -ForegroundColor Cyan
Write-Host "Pack:          $($pack.title)"
Write-Host "Pack key:      $($pack.packKey)"
Write-Host "Domain:        $($pack.domain.key)"
Write-Host "Competencies:  $($competencies.Count)"
Write-Host "Training units: $unitCount"
Write-Host "Drills:         $drillCount"
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

if ($competencies.Count -eq 0) { throw "Teaching pack contains no competencies." }
if ($unitCount -eq 0) { throw "Teaching pack contains no training units." }

if (-not $OwnerApproved) {
  Write-Host "`n=== PREVIEW ONLY ===" -ForegroundColor Yellow
  $competencies |
    Select-Object key,name,riskLevel,@{Name='units';Expression={@($_.units).Count}},@{Name='drills';Expression={@($_.drills).Count}} |
    Format-Table -AutoSize
  Write-Host "`nNo active training material was created. Re-run with -OwnerApproved only after Drew explicitly approves this exact teaching pack." -ForegroundColor Yellow
  exit 0
}

Write-Host "`n=== IMPORT OWNER-APPROVED TEACHING PACK ===" -ForegroundColor Cyan
$body = $pack | ConvertTo-Json -Depth 64
$result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/skill-academy/teaching-packs/import" -ContentType "application/json" -Body $body
$result | Format-List

if ($result.approvalStatus -ne "owner-approved") { throw "Teaching pack was not recorded as owner-approved." }
if ($result.trainingMaterialStatus -ne "active") { throw "Teaching pack units were not activated." }
if ([int]$result.importedCompetencies -ne $competencies.Count) { throw "Unexpected competency import count." }
if ([int]$result.importedUnits -ne $unitCount) { throw "Unexpected training-unit import count." }
if ([int]$result.importedDrills -ne $drillCount) { throw "Unexpected drill import count." }
if ($result.masteryChanged -ne $false) { throw "Teaching import incorrectly changed mastery." }

Write-Host "`n=== VERIFY DOMAIN CATALOG ===" -ForegroundColor Cyan
$domainKey = [uri]::EscapeDataString([string]$pack.domain.key)
$catalog = Invoke-RestMethod -Method Get -Uri "$BaseUrl/skill-academy/catalog?domainKey=$domainKey"
$domain = @($catalog.domains | Select-Object -First 1)
if ($domain.Count -ne 1) { throw "Skill domain was not returned after import." }

@($domain[0].competencies) |
  Select-Object competencyKey,name,riskLevel,masteryLevel,masteryScore,activeUnits,activeDrills |
  Format-Table -AutoSize

Write-Host "`nTeaching pack import complete." -ForegroundColor Green
Write-Host "Knowledge was activated without granting unearned mastery." -ForegroundColor Green
