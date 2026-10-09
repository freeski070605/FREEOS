param(
  [Parameter(Mandatory = $true)][string]$ProjectKey,
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
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 16 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

$ProjectKey = $ProjectKey.Trim()
if (-not $ProjectKey) { throw "ProjectKey is required." }

Write-Host "`n=== STABLE BASELINE INSPECTION STATUS ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/project-inspection/stable-status"
$status | ConvertTo-Json -Depth 8
if ($status.mode -ne "stable-governance-baseline") { throw "Stable baseline inspection mode is unavailable." }
if ($status.localSourceRequiredForApproval -ne $false) { throw "Stable baseline mode must not require a local source root." }
if ($status.dynamicCurrentStateRequiredForApproval -ne $false) { throw "Stable baseline mode must not require dynamic current state." }
if ($status.canonicalWritesEnabled -ne $false) { throw "Stable baseline inspection must not enable canonical writes." }

Write-Host "`n=== VERIFY PROJECT EDUCATION GAP ===" -ForegroundColor Cyan
$queuePath = "/continuous-learning/queue?status=open&signalType=project-education&projectKey=$ProjectKey&limit=50"
$queue = Invoke-FreeosJson -Method GET -Path $queuePath
$gaps = @($queue.items)
if ($gaps.Count -eq 0) {
  $coverage = Invoke-FreeosJson -Method GET -Path "/knowledge/status"
  $projectCoverage = @($coverage.coverage | Where-Object { $_.projectKey -eq $ProjectKey })
  if ($projectCoverage.Count -eq 1 -and [int]$projectCoverage[0].canonicalRecords -gt 0) {
    Write-Host "$ProjectKey already has active canonical project knowledge; no open project-education gap remains." -ForegroundColor Green
    $projectCoverage[0] | Format-List
    exit 0
  }
  throw "No open project-education learning gap exists for $ProjectKey."
}
$gap = $gaps[0]
$gap | Select-Object id,projectKey,signalType,priority,status,title | Format-Table -AutoSize

Write-Host "`n=== FIND / PREPARE PROJECT INSPECTION LEARNING WORK ===" -ForegroundColor Cyan
$workPath = "/learning-work/items?workType=project-inspection&projectKey=$ProjectKey&limit=100"
$workResponse = Invoke-FreeosJson -Method GET -Path $workPath
$usableWork = @($workResponse.items | Where-Object { $_.status -in @("prepared", "completed") } | Select-Object -First 1)

if ($usableWork.Count -eq 0) {
  $prepared = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare/$($gap.id)" -Body @{}
  $work = $prepared.work
} else {
  $work = $usableWork[0]
}
$work | Select-Object id,queueItemId,projectKey,workType,status,title | Format-Table -AutoSize
if ($work.workType -ne "project-inspection") { throw "Learning work is not project-inspection work." }

Write-Host "`n=== RUN STABLE GOVERNANCE BASELINE INSPECTION ===" -ForegroundColor Cyan
$inspection = Invoke-FreeosJson -Method POST -Path "/project-inspection/stable-from-work/$($work.id)" -Body @{}
$draft = $inspection.draft
$draft | Select-Object id,projectKey,status,learningWorkId,queueItemId,@{Name='unknownCount';Expression={@($_.unresolvedUnknowns).Count}} | Format-Table -AutoSize

if ($inspection.canonicalWritePerformed -ne $false) { throw "Stable inspection unexpectedly performed a canonical write." }
if ($inspection.durableMemoryCreated -ne $false) { throw "Stable inspection unexpectedly created durable memory." }
if ($inspection.queueResolved -ne $false) { throw "Stable inspection unexpectedly resolved the project-education gap." }
if ($inspection.localSourceRequiredForApproval -ne $false) { throw "Stable inspection unexpectedly requires a local source root." }
if ($inspection.dynamicCurrentStateRequiredForApproval -ne $false) { throw "Stable inspection unexpectedly requires dynamic current state." }

Write-Host "`n=== SEMANTIC SUPPORT ===" -ForegroundColor Cyan
$semantic = $draft.evidence.semanticSupport
$semantic | Select-Object ownershipClassification,ownerDirectionEstablished,directionRecordId,@{Name='canonicalSupportingRecords';Expression={@($_.canonicalSupportingRecords).Count}} | Format-List

Write-Host "`n=== NON-BLOCKING ADVISORIES ===" -ForegroundColor Cyan
$advisories = @($draft.evidence.advisories)
if ($advisories.Count -eq 0) { Write-Host "None." } else { $advisories | ForEach-Object { Write-Host "- $_" } }

Write-Host "`n=== REMAINING STABLE SEMANTIC UNKNOWNS ===" -ForegroundColor Cyan
$unknowns = @($draft.unresolvedUnknowns)
if ($unknowns.Count -eq 0) {
  Write-Host "None." -ForegroundColor Green
} else {
  $unknowns | ForEach-Object { Write-Host "- $_" -ForegroundColor Yellow }
}

Write-Host "`n=== BASELINE DRAFT PREVIEW ===" -ForegroundColor Cyan
@($draft.baselineDraft -split "`r?`n") | Select-Object -First 100 | ForEach-Object { Write-Host $_ }

Write-Host "`n=== PREPARE OWNER CANONICAL REVIEW ===" -ForegroundColor Cyan
$reviewResult = Invoke-FreeosJson -Method POST -Path "/project-baseline-review/prepare/$($draft.id)" -Body @{}
$review = $reviewResult.review
$review | Select-Object id,draftId,projectKey,status,@{Name='remainingUnknowns';Expression={@($_.remainingUnknowns).Count}},approvedKnowledgeRecordId | Format-Table -AutoSize

if ($reviewResult.canonicalWritePerformed -ne $false) { throw "Review preparation unexpectedly performed a canonical write." }
if ($reviewResult.ownerApprovalRequired -ne $true) { throw "Canonical review should require explicit owner approval." }

Write-Host "`n=== VERIFY PROJECT REMAINS NON-CANONICAL ===" -ForegroundColor Cyan
$governance = Invoke-FreeosJson -Method GET -Path "/knowledge/status"
$coverage = @($governance.coverage | Where-Object { $_.projectKey -eq $ProjectKey })
if ($coverage.Count -ne 1) { throw "Knowledge Governance coverage did not return $ProjectKey." }
$coverage[0] | Select-Object projectKey,projectName,baselineRecords,activeBaselineRecords,canonicalRecords,coverage | Format-Table -AutoSize

if ($unknowns.Count -eq 0) {
  if ($review.status -ne "pending") { throw "Stable semantic gaps are resolved but canonical review did not become pending." }
  if ([int]$coverage[0].canonicalRecords -ne 0) { throw "$ProjectKey became canonical before explicit owner approval." }
  Write-Host "`nStable project canonical review preparation complete." -ForegroundColor Green
  Write-Host "$ProjectKey has enough active controlling evidence for a stable baseline without inventing a local-source or live-state requirement." -ForegroundColor Green
  Write-Host "The canonical review is PENDING explicit owner approval; this script deliberately does NOT approve it." -ForegroundColor Green
} else {
  if ($review.status -ne "blocked") { throw "Review should remain blocked while stable semantic UNKNOWNs exist." }
  Write-Host "`nStable project canonical review preparation stopped at the correct governance gate." -ForegroundColor Yellow
  Write-Host "$ProjectKey still has $($unknowns.Count) unresolved stable semantic UNKNOWN(s); no canonical approval was attempted." -ForegroundColor Yellow
}
