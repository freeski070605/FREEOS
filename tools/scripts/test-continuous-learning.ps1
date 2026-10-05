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
  if ($Method -eq "GET") {
    return Invoke-RestMethod -Method Get -Uri $uri
  }

  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 8 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

$runKey = [Guid]::NewGuid().ToString("N").Substring(0, 10)

Write-Host "`n=== CONTINUOUS LEARNING STATUS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method GET -Path "/continuous-learning/status" | ConvertTo-Json -Depth 8

Write-Host "`n=== CREATE VALIDATION EXPERIENCE SIGNAL ===" -ForegroundColor Cyan
$experience = Invoke-FreeosJson -Method POST -Path "/experience" -Body @{
  projectKey = "freeos"
  sourceType = "continuous-learning-validation"
  sourceRef = "continuous-learning-$runKey"
  title = "Continuous Learning Engine validation failure"
  expectedResult = "A validation workflow completes on the first attempt."
  actualResult = "The synthetic validation workflow required a correction."
  outcome = "failure"
  cause = "Synthetic validation cause used only to prove queue discovery."
  evidence = "validation-run=$runKey"
  candidateLesson = "When this synthetic validation condition appears, review the evidence before proposing a durable lesson."
  scope = "project"
  sensitivity = "internal"
  confidence = "high"
}
$experience.event | Select-Object id,title,outcome,status,candidateLesson | Format-List

Write-Host "`n=== CREATE VALIDATION STALE CURRENT-INTELLIGENCE SIGNAL ===" -ForegroundColor Cyan
$stale = Invoke-FreeosJson -Method POST -Path "/current-intelligence/items" -Body @{
  sourceKey = "continuous-learning-stale-$runKey"
  topic = "Continuous Learning Engine stale validation"
  claim = "This synthetic claim exists only to prove stale-evidence discovery."
  projectKey = "freeos"
  sourceUrl = "local://freeos/continuous-learning-validation/$runKey"
  sourceTitle = "Continuous Learning validation"
  sourceClass = "live-observation"
  confidence = "confirmed"
  evidence = "validation-run=$runKey"
  observedAt = [DateTime]::UtcNow.AddDays(-2).ToString("o")
  freshnessDays = 1
}
$stale.item | Select-Object id,topic,status,observedAt,freshnessDays | Format-Table -AutoSize
if ($stale.item.status -ne "stale") { throw "Validation Current Intelligence item should be stale." }

Write-Host "`n=== RUN CONTINUOUS LEARNING ENGINE ===" -ForegroundColor Cyan
$run = Invoke-FreeosJson -Method POST -Path "/continuous-learning/run" -Body @{ triggerType = "validation" }
$run | ConvertTo-Json -Depth 8

Write-Host "`n=== VERIFY DISCOVERED LEARNING WORK ===" -ForegroundColor Cyan
$queue = Invoke-FreeosJson -Method GET -Path "/continuous-learning/queue?status=open&projectKey=freeos&limit=200"
$experienceRef = "experience:$($experience.event.id)"
$currentRef = "current-intelligence:$($stale.item.id)"
$experienceQueue = @($queue.items | Where-Object { $_.signalType -eq "experience-review" -and $_.sourceRef -eq $experienceRef })
$currentQueue = @($queue.items | Where-Object { $_.signalType -eq "current-intelligence-refresh" -and $_.sourceRef -eq $currentRef })

if ($experienceQueue.Count -ne 1) { throw "Continuous Learning Engine did not queue the validation experience signal exactly once." }
if ($currentQueue.Count -ne 1) { throw "Continuous Learning Engine did not queue the stale Current Intelligence signal exactly once." }

@($experienceQueue + $currentQueue) |
  Select-Object id,signalType,priority,title,status,recommendedAction |
  Format-Table -Wrap -AutoSize

Write-Host "`n=== REMOVE SOURCE CONDITIONS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method POST -Path "/experience/$($experience.event.id)/close" -Body @{} | Out-Null
Invoke-FreeosJson -Method POST -Path "/current-intelligence/items/$($stale.item.id)/archive" -Body @{} | Out-Null

Write-Host "`n=== RUN ENGINE AGAIN TO VERIFY AUTO-RESOLUTION ===" -ForegroundColor Cyan
$secondRun = Invoke-FreeosJson -Method POST -Path "/continuous-learning/run" -Body @{ triggerType = "validation-cleanup" }
$secondRun | ConvertTo-Json -Depth 8

$openAfter = Invoke-FreeosJson -Method GET -Path "/continuous-learning/queue?status=open&projectKey=freeos&limit=200"
$remainingValidation = @($openAfter.items | Where-Object { $_.sourceRef -eq $experienceRef -or $_.sourceRef -eq $currentRef })
if ($remainingValidation.Count -ne 0) { throw "Resolved validation signals remained open after their source conditions disappeared." }

Write-Host "`n=== FINAL CONTINUOUS LEARNING STATUS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method GET -Path "/continuous-learning/status" | ConvertTo-Json -Depth 8

Write-Host "`nContinuous Learning Engine validation complete." -ForegroundColor Green
Write-Host "FREEOS discovered learning work from experience and stale intelligence without creating durable memory." -ForegroundColor Green
Write-Host "When the underlying conditions disappeared, the engine automatically resolved those queue items." -ForegroundColor Green
