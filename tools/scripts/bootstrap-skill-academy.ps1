param(
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-FreeosJson {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("GET", "POST")][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body
  )

  $uri = "$BaseUrl$Path"
  if ($Method -eq "GET") { return Invoke-RestMethod -Method Get -Uri $uri }
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 32 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== BOOTSTRAP FREEOS SKILL ACADEMY ===" -ForegroundColor Cyan
$result = Invoke-FreeosJson -Method POST -Path "/skill-academy/bootstrap" -Body @{}
$result.status | Format-List

if ($result.masteryChanged -ne $false) { throw "Bootstrap unexpectedly changed mastery." }
if ($result.durableMemoryCreated -ne $false) { throw "Bootstrap unexpectedly created durable memory." }
if ([int]$result.status.domains -lt 4) { throw "Expected at least four skill domains." }
if ([int]$result.status.competencies -lt 40) { throw "Expected at least forty competency scaffolds." }

Write-Host "`n=== SKILL CATALOG ===" -ForegroundColor Cyan
$catalog = Invoke-FreeosJson -Method GET -Path "/skill-academy/catalog"
foreach ($domain in @($catalog.domains)) {
  Write-Host "`n[$($domain.domainKey)] $($domain.name)" -ForegroundColor Yellow
  @($domain.competencies) |
    Select-Object competencyKey,name,riskLevel,masteryLevel,masteryScore,activeUnits,activeDrills |
    Format-Table -AutoSize
}

Write-Host "`n=== VERIFY KNOWLEDGE != MASTERY ===" -ForegroundColor Cyan
$nonTheory = @($catalog.domains | ForEach-Object { $_.competencies } | Where-Object { $_.masteryLevel -ne "theory" })
if ($nonTheory.Count -ne 0) { throw "Scaffold bootstrap incorrectly advanced one or more competencies beyond theory." }

Write-Host "`nFREEOS Skill Academy bootstrap complete." -ForegroundColor Green
Write-Host "The curriculum scaffold is ready. No skill mastery was granted by bootstrap." -ForegroundColor Green
Write-Host "Next teaching can be imported in bulk as owner-approved Teaching Packs instead of one lesson/approval at a time." -ForegroundColor Green
