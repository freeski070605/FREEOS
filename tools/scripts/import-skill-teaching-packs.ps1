param(
  [Parameter(Mandatory = $true)][string[]]$PackPath,
  [switch]$OwnerApproved,
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$packs = @()

foreach ($path in @($PackPath)) {
  $resolved = if ([System.IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $root $path }
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "Teaching pack not found: $resolved"
  }

  $pack = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
  $pack | Add-Member -NotePropertyName ownerApproved -NotePropertyValue ([bool]$OwnerApproved) -Force

  $competencies = @($pack.competencies)
  if ($competencies.Count -eq 0) { throw "Teaching pack contains no competencies: $resolved" }

  $unitCount = 0
  $drillCount = 0
  foreach ($competency in $competencies) {
    $unitCount += @($competency.units).Count
    $drillCount += @($competency.drills).Count
  }
  if ($unitCount -eq 0) { throw "Teaching pack contains no training units: $resolved" }

  $packs += [pscustomobject]@{
    Path = $resolved
    Pack = $pack
    PackKey = [string]$pack.packKey
    Title = [string]$pack.title
    DomainKey = [string]$pack.domain.key
    CompetencyCount = $competencies.Count
    UnitCount = $unitCount
    DrillCount = $drillCount
  }
}

Write-Host "`n=== SKILL ACADEMY BATCH ===" -ForegroundColor Cyan
$packs |
  Select-Object Title,PackKey,DomainKey,CompetencyCount,UnitCount,DrillCount |
  Format-Table -AutoSize

$totalCompetencies = ($packs | Measure-Object -Property CompetencyCount -Sum).Sum
$totalUnits = ($packs | Measure-Object -Property UnitCount -Sum).Sum
$totalDrills = ($packs | Measure-Object -Property DrillCount -Sum).Sum
Write-Host "Packs:         $($packs.Count)"
Write-Host "Competencies:  $totalCompetencies"
Write-Host "Training units: $totalUnits"
Write-Host "Drills:         $totalDrills"
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

if (-not $OwnerApproved) {
  Write-Host "`n=== PREVIEW ONLY ===" -ForegroundColor Yellow
  Write-Host "No active training material was created." -ForegroundColor Yellow
  Write-Host "Re-run the exact same batch with -OwnerApproved only after Drew explicitly approves every listed pack." -ForegroundColor Yellow
  exit 0
}

$results = @()
foreach ($entry in $packs) {
  Write-Host "`n=== IMPORT: $($entry.Title) ===" -ForegroundColor Cyan
  $body = $entry.Pack | ConvertTo-Json -Depth 64
  $result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/skill-academy/teaching-packs/import" -ContentType "application/json" -Body $body

  if ($result.approvalStatus -ne "owner-approved") { throw "$($entry.PackKey) was not recorded as owner-approved." }
  if ($result.trainingMaterialStatus -ne "active") { throw "$($entry.PackKey) training material was not activated." }
  if ([int]$result.importedCompetencies -ne [int]$entry.CompetencyCount) { throw "$($entry.PackKey) competency count mismatch." }
  if ([int]$result.importedUnits -ne [int]$entry.UnitCount) { throw "$($entry.PackKey) training-unit count mismatch." }
  if ([int]$result.importedDrills -ne [int]$entry.DrillCount) { throw "$($entry.PackKey) drill count mismatch." }
  if ($result.masteryChanged -ne $false) { throw "$($entry.PackKey) incorrectly changed mastery." }

  $results += $result
  $result | Select-Object packKey,approvalStatus,trainingMaterialStatus,importedCompetencies,importedUnits,importedDrills,masteryChanged | Format-List
}

Write-Host "`n=== VERIFY IMPORTED DOMAINS ===" -ForegroundColor Cyan
foreach ($domainKey in @($packs.DomainKey | Select-Object -Unique)) {
  $escaped = [uri]::EscapeDataString([string]$domainKey)
  $catalog = Invoke-RestMethod -Method Get -Uri "$BaseUrl/skill-academy/catalog?domainKey=$escaped"
  $domain = @($catalog.domains | Select-Object -First 1)
  if ($domain.Count -ne 1) { throw "Skill domain was not returned after import: $domainKey" }

  Write-Host "`n[$domainKey]" -ForegroundColor Yellow
  @($domain[0].competencies) |
    Select-Object competencyKey,name,riskLevel,masteryLevel,masteryScore,activeUnits,activeDrills |
    Format-Table -AutoSize
}

$advanced = @()
foreach ($domainKey in @($packs.DomainKey | Select-Object -Unique)) {
  $escaped = [uri]::EscapeDataString([string]$domainKey)
  $catalog = Invoke-RestMethod -Method Get -Uri "$BaseUrl/skill-academy/catalog?domainKey=$escaped"
  $advanced += @($catalog.domains | ForEach-Object { $_.competencies } | Where-Object { $_.masteryLevel -ne "theory" })
}
if ($advanced.Count -ne 0) { throw "Teaching import incorrectly advanced one or more competencies beyond theory." }

Write-Host "`nSkill Academy batch import complete." -ForegroundColor Green
Write-Host "$($packs.Count) owner-approved teaching packs were activated in one run." -ForegroundColor Green
Write-Host "Knowledge was activated without granting unearned mastery." -ForegroundColor Green
