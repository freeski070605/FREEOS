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

  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 10 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

$runKey = [Guid]::NewGuid().ToString("N").Substring(0, 10)

Write-Host "`n=== LEARNING WORK EXECUTOR STATUS ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/learning-work/status"
$status | ConvertTo-Json -Depth 8
if ($status.mode -ne "prepare-only") { throw "Learning Work Executor must remain prepare-only in v1." }
if ($status.durableLearningRequiresApproval -ne $true) { throw "Durable learning approval gate is not active." }

Write-Host "`n=== CREATE EXPERIENCE SIGNAL FOR EXPERIMENT PLANNING ===" -ForegroundColor Cyan
$experience = Invoke-FreeosJson -Method POST -Path "/experience" -Body @{
  projectKey = "freeos"
  sourceType = "learning-work-validation"
  sourceRef = "learning-work-experience-$runKey"
  title = "Learning Work Executor synthetic failure"
  expectedResult = "The synthetic workflow succeeds on the first attempt."
  actualResult = "The synthetic workflow failed and needs a reversible test before the lesson is trusted."
  outcome = "failure"
  cause = "Synthetic validation cause."
  evidence = "validation-run=$runKey"
  candidateLesson = "A reversible test should confirm this synthetic lesson before it becomes durable knowledge."
  scope = "project"
  sensitivity = "internal"
  confidence = "high"
}

Write-Host "`n=== CREATE STALE SIGNAL FOR RESEARCH-VERIFICATION PLANNING ===" -ForegroundColor Cyan
$stale = Invoke-FreeosJson -Method POST -Path "/current-intelligence/items" -Body @{
  sourceKey = "learning-work-current-$runKey"
  topic = "Learning Work Executor stale research validation"
  claim = "This synthetic time-sensitive claim must be re-verified."
  projectKey = "freeos"
  sourceUrl = "local://freeos/learning-work-validation/$runKey"
  sourceTitle = "Learning Work Executor validation"
  sourceClass = "live-observation"
  confidence = "confirmed"
  evidence = "validation-run=$runKey"
  observedAt = [DateTime]::UtcNow.AddDays(-2).ToString("o")
  freshnessDays = 1
}
if ($stale.item.status -ne "stale") { throw "Synthetic Current Intelligence item should be stale." }

Write-Host "`n=== DISCOVER LEARNING QUEUE SIGNALS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method POST -Path "/continuous-learning/run" -Body @{ triggerType = "learning-work-validation" } | Out-Null
$queue = Invoke-FreeosJson -Method GET -Path "/continuous-learning/queue?status=open&projectKey=freeos&limit=250"
$experienceRef = "experience:$($experience.event.id)"
$currentRef = "current-intelligence:$($stale.item.id)"
$experienceQueue = @($queue.items | Where-Object { $_.sourceRef -eq $experienceRef })
$currentQueue = @($queue.items | Where-Object { $_.sourceRef -eq $currentRef })
if ($experienceQueue.Count -ne 1) { throw "Expected exactly one experience learning queue item." }
if ($currentQueue.Count -ne 1) { throw "Expected exactly one stale-current-intelligence learning queue item." }

Write-Host "`n=== PREPARE EXPERIMENT WORK ===" -ForegroundColor Cyan
$experimentWork = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare/$($experienceQueue[0].id)" -Body @{}
$experimentWork.work | Select-Object id,queueItemId,workType,status,title,objective,acceptanceCriteria,boundaries | Format-List
if ($experimentWork.work.workType -ne "experiment") { throw "Experience failure should prepare experiment work." }
if ($experimentWork.work.status -ne "prepared") { throw "Experiment work should be prepared, not executed." }

Write-Host "`n=== PREPARE RESEARCH-VERIFICATION WORK ===" -ForegroundColor Cyan
$researchWork = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare/$($currentQueue[0].id)" -Body @{}
$researchWork.work | Select-Object id,queueItemId,workType,status,title,objective,acceptanceCriteria,boundaries | Format-List
if ($researchWork.work.workType -ne "research-verification") { throw "Stale Current Intelligence should prepare research-verification work." }

Write-Host "`n=== PREPARE ONE REAL PROJECT-EDUCATION ITEM WHEN AVAILABLE ===" -ForegroundColor Cyan
$allOpen = Invoke-FreeosJson -Method GET -Path "/continuous-learning/queue?status=open&limit=250"
$projectEducation = @($allOpen.items | Where-Object { $_.signalType -eq "project-education" } | Select-Object -First 1)
if ($projectEducation.Count -eq 1) {
  $projectWork = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare/$($projectEducation[0].id)" -Body @{}
  $projectWork.work | Select-Object id,queueItemId,projectKey,workType,status,title | Format-Table -AutoSize
  if ($projectWork.work.workType -ne "project-inspection") { throw "Project education should prepare project-inspection work." }
} else {
  Write-Host "No open project-education item exists; project-inspection mapping was not needed for this repository state." -ForegroundColor Yellow
}

Write-Host "`n=== VERIFY PREPARED WORK IS IDEMPOTENT ===" -ForegroundColor Cyan
$repeat = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare/$($experienceQueue[0].id)" -Body @{}
if ($repeat.work.id -ne $experimentWork.work.id) { throw "Preparing the same queue item created duplicate work." }

Write-Host "`n=== LEARNING WORK STATUS AFTER PREPARATION ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method GET -Path "/learning-work/status" | ConvertTo-Json -Depth 8

Write-Host "`n=== REMOVE SYNTHETIC SOURCE CONDITIONS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method POST -Path "/experience/$($experience.event.id)/close" -Body @{} | Out-Null
Invoke-FreeosJson -Method POST -Path "/current-intelligence/items/$($stale.item.id)/archive" -Body @{} | Out-Null
Invoke-FreeosJson -Method POST -Path "/continuous-learning/run" -Body @{ triggerType = "learning-work-validation-cleanup" } | Out-Null

Write-Host "`n=== RECONCILE PREPARED WORK ===" -ForegroundColor Cyan
$reconcile = Invoke-FreeosJson -Method POST -Path "/learning-work/reconcile" -Body @{}
$reconcile | ConvertTo-Json -Depth 8

$experimentAfter = Invoke-FreeosJson -Method GET -Path "/learning-work/items/$($experimentWork.work.id)"
$researchAfter = Invoke-FreeosJson -Method GET -Path "/learning-work/items/$($researchWork.work.id)"
if ($experimentAfter.item.status -ne "cancelled") { throw "Prepared experiment work should cancel when its queue source resolves." }
if ($researchAfter.item.status -ne "cancelled") { throw "Prepared research work should cancel when its queue source resolves." }

Write-Host "`nLearning Work Executor validation complete." -ForegroundColor Green
Write-Host "FREEOS classified learning needs into work types and prepared bounded plans without executing external research, experiments, canonical writes, or durable memory." -ForegroundColor Green
Write-Host "Repeated preparation was idempotent, and prepared synthetic work cancelled after its source learning conditions were resolved." -ForegroundColor Green
