param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$ProjectKey = "dfb-ai-studio"
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

  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 12 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== FIND PENDING AI STUDIO BASELINE REVIEW ===" -ForegroundColor Cyan
$reviewPath = "/project-baseline-review/reviews?projectKey=$ProjectKey&status=pending&limit=20"
$reviewResponse = Invoke-FreeosJson -Method GET -Path $reviewPath
$reviews = @($reviewResponse.reviews)
if ($reviews.Count -ne 1) {
  throw "Expected exactly one pending canonical review for $ProjectKey, found $($reviews.Count)."
}

$review = $reviews[0]
$review | Select-Object id,draftId,projectKey,status,@{Name='remainingUnknowns';Expression={@($_.remainingUnknowns).Count}},approvedKnowledgeRecordId | Format-Table -AutoSize

if ($review.projectKey -ne $ProjectKey) { throw "Pending review belongs to unexpected project: $($review.projectKey)." }
if ($review.status -ne "pending") { throw "AI Studio review is not pending." }
if (@($review.remainingUnknowns).Count -ne 0) { throw "AI Studio review still contains unresolved UNKNOWNs." }
if ($null -ne $review.approvedKnowledgeRecordId) { throw "AI Studio review already has an approved knowledge record." }

Write-Host "`n=== EXECUTE EXPLICIT OWNER APPROVAL ===" -ForegroundColor Cyan
$approval = Invoke-FreeosJson -Method POST -Path "/project-baseline-review/reviews/$($review.id)/approve" -Body @{}
$approval.review | Select-Object id,draftId,projectKey,status,approvedKnowledgeRecordId,reviewedAt | Format-Table -AutoSize

if ($approval.canonicalWritePerformed -ne $true) { throw "Canonical approval did not report a canonical write." }
if ($approval.durableMemoryCreated -ne $false) { throw "Canonical approval unexpectedly created durable memory." }
if ($approval.review.status -ne "approved") { throw "AI Studio review did not become approved." }
if ($null -eq $approval.review.approvedKnowledgeRecordId) { throw "Approved review did not receive a canonical knowledge record ID." }
if ($approval.knowledgeRecord.authority -ne "approved-canonical") { throw "Approved AI Studio baseline does not have approved-canonical authority." }
if ($approval.knowledgeRecord.status -ne "active") { throw "Approved AI Studio baseline is not active." }
if ($approval.knowledgeRecord.projectKey -ne $ProjectKey) { throw "Canonical knowledge record is scoped to the wrong project." }

Write-Host "`n=== CANONICAL KNOWLEDGE RECORD ===" -ForegroundColor Cyan
$approval.knowledgeRecord | Select-Object id,projectKey,title,authority,authorityRank,status,confidence,sensitivity,sourceType,sourceRef | Format-List

Write-Host "`n=== VERIFY CANONICAL BASELINE LINK ===" -ForegroundColor Cyan
$baselinesPath = "/knowledge/baselines?projectKey=$ProjectKey"
$baselines = Invoke-FreeosJson -Method GET -Path $baselinesPath
$canonical = @($baselines.baselines | Where-Object {
  $_.role -eq "canonical" -and
  $_.knowledge_record_id -eq $approval.review.approvedKnowledgeRecordId -and
  $_.status -eq "active"
})
if ($canonical.Count -ne 1) { throw "Approved AI Studio knowledge record is not linked as the active canonical project baseline." }
$canonical | Select-Object project_key,role,knowledge_record_id,title,authority,authority_rank,status,source_type | Format-Table -AutoSize

Write-Host "`n=== VERIFY PROJECT KNOWLEDGE COVERAGE ===" -ForegroundColor Cyan
$knowledge = Invoke-FreeosJson -Method GET -Path "/knowledge/status"
$coverage = @($knowledge.coverage | Where-Object { $_.projectKey -eq $ProjectKey })
if ($coverage.Count -ne 1) { throw "Knowledge Governance did not return coverage for $ProjectKey." }
$coverage[0] | Select-Object projectKey,projectName,baselineRecords,activeBaselineRecords,canonicalRecords,coverage | Format-Table -AutoSize
if ([int]$coverage[0].canonicalRecords -lt 1) { throw "AI Studio still has no active canonical knowledge record after approval." }

Write-Host "`n=== VERIFY LEARNING GAP RESOLUTION ===" -ForegroundColor Cyan
$queuePath = "/continuous-learning/queue?signalType=project-education&projectKey=$ProjectKey&limit=20"
$queue = Invoke-FreeosJson -Method GET -Path $queuePath
$open = @($queue.items | Where-Object { $_.status -eq "open" })
if ($open.Count -ne 0) { throw "AI Studio project-education learning gap remains open after canonical approval." }
@($queue.items) | Select-Object id,projectKey,signalType,status,title | Format-Table -AutoSize

Write-Host "`nDFB AI Studio canonical baseline approval complete." -ForegroundColor Green
Write-Host "The owner-approved baseline is now active approved-canonical project knowledge and linked as the canonical baseline." -ForegroundColor Green
Write-Host "No durable memory was created automatically; the change is represented in Knowledge Governance and the project learning gap is closed." -ForegroundColor Green
