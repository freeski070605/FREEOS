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
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 10 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== PROJECT INSPECTION STATUS ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/project-inspection/status"
$status | ConvertTo-Json -Depth 8
if ($status.mode -ne "read-only-inspect-and-draft") { throw "Project Inspection must remain read-only inspect-and-draft." }
if ($status.canonicalWritesEnabled -ne $false) { throw "Project Inspection must not enable canonical writes." }

Write-Host "`n=== FIND REAL PROJECT-INSPECTION WORK ===" -ForegroundColor Cyan
$prepared = Invoke-FreeosJson -Method GET -Path "/learning-work/items?status=prepared&workType=project-inspection&limit=100"
$work = @($prepared.items | Select-Object -First 1)

if ($work.Count -eq 0) {
  $queue = Invoke-FreeosJson -Method GET -Path "/continuous-learning/queue?status=open&signalType=project-education&limit=100"
  $projectGap = @($queue.items | Select-Object -First 1)
  if ($projectGap.Count -eq 0) { throw "No real project-education gap is open for inspection." }
  $preparedWork = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare/$($projectGap[0].id)" -Body @{}
  $work = @($preparedWork.work)
}

$work[0] | Select-Object id,queueItemId,projectKey,workType,status,title | Format-Table -AutoSize
if ($work[0].workType -ne "project-inspection") { throw "Selected learning work is not project-inspection work." }

Write-Host "`n=== RUN READ-ONLY PROJECT INSPECTION ===" -ForegroundColor Cyan
$inspection = Invoke-FreeosJson -Method POST -Path "/project-inspection/from-work/$($work[0].id)" -Body @{}
$inspection.draft | Select-Object id,projectKey,status,learningWorkId,queueItemId,@{Name='unknownCount';Expression={@($_.unresolvedUnknowns).Count}} | Format-Table -AutoSize

if ($inspection.canonicalWritePerformed -ne $false) { throw "Project Inspection unexpectedly performed a canonical write." }
if ($inspection.durableMemoryCreated -ne $false) { throw "Project Inspection unexpectedly created durable memory." }
if ($inspection.queueResolved -ne $false) { throw "Inspection should not resolve the project-education queue before canonical review." }
if ($inspection.draft.baselineDraft -notmatch "DRAFT — NOT CANONICAL") { throw "Baseline draft is missing its non-canonical warning." }

Write-Host "`n=== EVIDENCE COUNTS ===" -ForegroundColor Cyan
$inspection.draft.evidence.counts | Format-List

Write-Host "`n=== UNRESOLVED UNKNOWNS ===" -ForegroundColor Cyan
@($inspection.draft.unresolvedUnknowns) | ForEach-Object { Write-Host "- $_" }

Write-Host "`n=== BASELINE DRAFT PREVIEW ===" -ForegroundColor Cyan
$preview = @($inspection.draft.baselineDraft -split "`r?`n") | Select-Object -First 80
$preview | ForEach-Object { Write-Host $_ }

Write-Host "`n=== VERIFY INSPECTION IS IDEMPOTENT ===" -ForegroundColor Cyan
$repeat = Invoke-FreeosJson -Method POST -Path "/project-inspection/from-work/$($work[0].id)" -Body @{}
if ($repeat.draft.id -ne $inspection.draft.id) { throw "Repeated inspection created a duplicate project draft." }

Write-Host "`n=== VERIFY LEARNING WORK COMPLETED BUT GAP REMAINS OPEN ===" -ForegroundColor Cyan
$workAfter = Invoke-FreeosJson -Method GET -Path "/learning-work/items/$($work[0].id)"
$queueAfter = Invoke-FreeosJson -Method GET -Path "/continuous-learning/queue?status=open&signalType=project-education&projectKey=$($work[0].projectKey)&limit=20"
$workAfter.item | Select-Object id,projectKey,workType,status,resultSummary | Format-List
if ($workAfter.item.status -ne "completed") { throw "Read-only project inspection should complete its learning work item." }
if (@($queueAfter.items).Count -lt 1) { throw "Project education gap should remain open until canonical review closes it." }

Write-Host "`nProject Inspection validation complete." -ForegroundColor Green
Write-Host "FREEOS inspected a real project gap, assembled local evidence, preserved UNKNOWNs, and produced a non-canonical baseline draft without fabricating facts." -ForegroundColor Green
Write-Host "The inspection work completed, but the learning gap remains open until a separately governed canonical review is completed." -ForegroundColor Green
