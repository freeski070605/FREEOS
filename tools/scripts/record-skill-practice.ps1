param(
  [Parameter(Mandatory = $true)][string]$CompetencyKey,
  [Parameter(Mandatory = $true)][string]$ResultSummary,
  [string]$Evidence = "",
  [string]$DrillKey = "",
  [Nullable[double]]$Score = $null,
  [switch]$HumanReviewed,
  [string]$Evaluator = "Drew",
  [string]$EvaluationNotes = "",
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
  if ($Method -eq "GET") {
    return Invoke-RestMethod -Method Get -Uri $uri
  }

  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 16 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

$CompetencyKey = $CompetencyKey.Trim()
$ResultSummary = $ResultSummary.Trim()
if (-not $CompetencyKey) { throw "CompetencyKey is required." }
if (-not $ResultSummary) { throw "ResultSummary is required." }

$domainKey = ($CompetencyKey -split '\.', 2)[0]
$catalog = Invoke-FreeosJson -Method GET -Path "/skill-academy/catalog?domainKey=$([uri]::EscapeDataString($domainKey))"
$domain = @($catalog.domains | Select-Object -First 1)
if ($domain.Count -ne 1) { throw "Unknown skill domain for competency: $CompetencyKey" }
$competency = @($domain[0].competencies | Where-Object { $_.competencyKey -eq $CompetencyKey })
if ($competency.Count -ne 1) { throw "Unknown competencyKey: $CompetencyKey" }

Write-Host "`n=== RECORD REAL-WORK SKILL PRACTICE ===" -ForegroundColor Cyan
$competency[0] | Select-Object competencyKey,name,riskLevel,masteryLevel,masteryScore,practiceCount,passedCount | Format-List

$practiceBody = @{
  competencyKey = $CompetencyKey
  resultSummary = $ResultSummary
  evidence = $Evidence
}
if ($DrillKey.Trim()) { $practiceBody.drillKey = $DrillKey.Trim() }

$created = Invoke-FreeosJson -Method POST -Path "/skill-academy/practice" -Body $practiceBody
$session = $created.session
$session | Format-List

if ($created.masteryChanged -ne $false) { throw "Recording practice unexpectedly changed mastery before evaluation." }

if ($PSBoundParameters.ContainsKey("Score")) {
  $scoreValue = [double]$Score
  if ($scoreValue -lt 0 -or $scoreValue -gt 100) { throw "Score must be between 0 and 100." }

  Write-Host "`n=== EVALUATE PRACTICE ===" -ForegroundColor Cyan
  $evaluation = Invoke-FreeosJson -Method POST -Path "/skill-academy/practice/$($session.id)/evaluate" -Body @{
    score = $scoreValue
    humanReviewed = [bool]$HumanReviewed
    evaluator = $Evaluator
    notes = $EvaluationNotes
  }
  $evaluation | Format-List

  if ($competency[0].riskLevel -ne "standard" -and -not $HumanReviewed) {
    Write-Host "`nEvaluation recorded, but this elevated/safety-critical competency does not count toward mastery without -HumanReviewed." -ForegroundColor Yellow
  }
}
else {
  Write-Host "`nPractice recorded without evaluation. Mastery remains unchanged until an evaluation is submitted." -ForegroundColor Yellow
}

Write-Host "`n=== UPDATED COMPETENCY STATE ===" -ForegroundColor Cyan
$updatedCatalog = Invoke-FreeosJson -Method GET -Path "/skill-academy/catalog?domainKey=$([uri]::EscapeDataString($domainKey))"
$updated = @($updatedCatalog.domains[0].competencies | Where-Object { $_.competencyKey -eq $CompetencyKey })
$updated | Select-Object competencyKey,name,riskLevel,masteryLevel,masteryScore,practiceCount,passedCount,activeUnits,activeDrills | Format-List

Write-Host "`nSkill practice capture complete." -ForegroundColor Green
