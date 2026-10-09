param(
  [Parameter(Mandatory = $true)][string[]]$PackPath,
  [switch]$OwnerApproved,
  [ValidatePattern('^https?://')][string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PackPath.Count -gt 1) {
  Write-Host "`nNOTE: Multiple teaching packs detected. Explicit PowerShell array syntax is recommended:" -ForegroundColor Yellow
  Write-Host '  -PackPath @("path1.json", "path2.json")' -ForegroundColor Yellow
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$packs = @()

foreach ($path in @($PackPath)) {
  $resolvedPackPath = if ([System.IO.Path]::IsPathRooted($path)) { $path } else { Join-Path $root $path }
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

  if ($competencies.Count -eq 0) { throw "Teaching pack contains no competencies: $resolvedPackPath" }
  if ($unitCount -eq 0) { throw "Teaching pack contains no training units: $resolvedPackPath" }

  $packs += [pscustomobject]@{
    Path = $resolvedPackPath
    Pack = $pack
    Competencies = $competencies
    UnitCount = $unitCount
    DrillCount = $drillCount
  }
}

Write-Host "`n=== SKILL TEACHING PACK BATCH ===" -ForegroundColor Cyan
foreach ($entry in $packs) {
  Write-Host "`nPack:           $($entry.Pack.title)" -ForegroundColor Yellow
  Write-Host "Pack key:       $($entry.Pack.packKey)"
  Write-Host "Domain:         $($entry.Pack.domain.key)"
  Write-Host "Competencies:   $($entry.Competencies.Count)"
  Write-Host "Training units: $($entry.UnitCount)"
  Write-Host "Drills:         $($entry.DrillCount)"
}
Write-Host "`nOwnerApproved: $([bool]$OwnerApproved)"
Write-Host "Packs in batch: $($packs.Count)"

if (-not $OwnerApproved) {
  Write-Host "`n=== PREVIEW ONLY ===" -ForegroundColor Yellow
  foreach ($entry in $packs) {
    Write-Host "`n[$($entry.Pack.domain.key)] $($entry.Pack.title)" -ForegroundColor Cyan
    $entry.Competencies |
      Select-Object key,name,riskLevel,@{Name='units';Expression={@($_.units).Count}},@{Name='drills';Expression={@($_.drills).Count}} |
      Format-Table -AutoSize
  }
  Write-Host "`nNo active training material was created. Re-run with -OwnerApproved only after Drew explicitly approves every exact pack in this batch." -ForegroundColor Yellow
  exit 0
}

$results = @()
foreach ($entry in $packs) {
  Write-Host "`n=== IMPORT: $($entry.Pack.title) ===" -ForegroundColor Cyan
  $body = $entry.Pack | ConvertTo-Json -Depth 64
  $result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/skill-academy/teaching-packs/import" -ContentType "application/json" -Body $body
  $result | Format-List

  if ($result.approvalStatus -ne "owner-approved") { throw "Teaching pack was not recorded as owner-approved: $($entry.Pack.packKey)" }
  if ($result.trainingMaterialStatus -ne "active") { throw "Teaching pack units were not activated: $($entry.Pack.packKey)" }
  if ([int]$result.importedCompetencies -ne $entry.Competencies.Count) { throw "Unexpected competency import count: $($entry.Pack.packKey)" }
  if ([int]$result.importedUnits -ne $entry.UnitCount) { throw "Unexpected training-unit import count: $($entry.Pack.packKey)" }
  if ([int]$result.importedDrills -ne $entry.DrillCount) { throw "Unexpected drill import count: $($entry.Pack.packKey)" }
  if ($result.masteryChanged -ne $false) { throw "Teaching import incorrectly changed mastery: $($entry.Pack.packKey)" }

  Write-Host "`n=== VERIFY DOMAIN: $($entry.Pack.domain.key) ===" -ForegroundColor Cyan
  $domainKey = [uri]::EscapeDataString([string]$entry.Pack.domain.key)
  $catalog = Invoke-RestMethod -Method Get -Uri "$BaseUrl/skill-academy/catalog?domainKey=$domainKey"
  $domain = @($catalog.domains | Select-Object -First 1)
  if ($domain.Count -ne 1) { throw "Skill domain was not returned after import: $($entry.Pack.domain.key)" }

  @($domain[0].competencies) |
    Select-Object competencyKey,name,riskLevel,masteryLevel,masteryScore,activeUnits,activeDrills |
    Format-Table -AutoSize

  $results += $result
}

Write-Host "`nSkill teaching-pack batch import complete." -ForegroundColor Green
Write-Host "$($packs.Count) pack(s) activated without granting unearned mastery." -ForegroundColor Green
