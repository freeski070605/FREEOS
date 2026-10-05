param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$ProjectKey = "signalflow"
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

Write-Host "`n=== CANONICAL BASELINE REVIEW STATUS ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/project-baseline-review/status"
$status | ConvertTo-Json -Depth 8
if ($status.mode -ne "owner-approved-canonicalization") { throw "Canonical baseline review is not in owner-approved mode." }
if ($status.canonicalWritesRequireExplicitApproval -ne $true) { throw "Canonical writes must require explicit owner approval." }
if ($status.unresolvedUnknownsBlockApproval -ne $true) { throw "Unresolved UNKNOWNs must block approval." }

Write-Host "`n=== LOAD REAL PROJECT INSPECTION DRAFT ===" -ForegroundColor Cyan
$draftPath = "/project-inspection/drafts?projectKey=$ProjectKey&limit=20"
$drafts = Invoke-FreeosJson -Method GET -Path $draftPath
$draft = @($drafts.drafts | Select-Object -First 1)
if ($draft.Count -ne 1) { throw "No project inspection draft exists for $ProjectKey." }
$draft[0] | Select-Object id,projectKey,status,@{Name='unknownCount';Expression={@($_.unresolvedUnknowns).Count}} | Format-Table -AutoSize

Write-Host "`n=== PREPARE CANONICAL REVIEW ===" -ForegroundColor Cyan
$prepared = Invoke-FreeosJson -Method POST -Path "/project-baseline-review/prepare/$($draft[0].id)" -Body @{}
$prepared.review | Select-Object id,draftId,projectKey,status,@{Name='remainingUnknowns';Expression={@($_.remainingUnknowns).Count}},approvedKnowledgeRecordId | Format-Table -AutoSize

if ($prepared.canonicalWritePerformed -ne $false) { throw "Preparing a review must not perform a canonical write." }
if ($prepared.ownerApprovalRequired -ne $true) { throw "Canonical review must require owner approval." }
if (@($prepared.review.remainingUnknowns).Count -lt 1) { throw "This validation expects the real project draft to retain unresolved UNKNOWNs." }
if ($prepared.review.status -ne "blocked") { throw "A review with unresolved UNKNOWNs must be blocked." }

Write-Host "`n=== VERIFY PREPARATION IS IDEMPOTENT ===" -ForegroundColor Cyan
$repeat = Invoke-FreeosJson -Method POST -Path "/project-baseline-review/prepare/$($draft[0].id)" -Body @{}
if ($repeat.review.id -ne $prepared.review.id) { throw "Preparing the same project draft created a duplicate review." }

Write-Host "`n=== VERIFY BLOCKED REVIEW CANNOT BE APPROVED ===" -ForegroundColor Cyan
$approvalWasBlocked = $false
try {
  Invoke-FreeosJson -Method POST -Path "/project-baseline-review/reviews/$($prepared.review.id)/approve" -Body @{} | Out-Null
} catch {
  $approvalWasBlocked = $true
  Write-Host "Approval blocked as expected because unresolved UNKNOWNs remain." -ForegroundColor Yellow
}
if (-not $approvalWasBlocked) { throw "Blocked project baseline review was unexpectedly approved." }

Write-Host "`n=== VERIFY PROJECT REMAINS NON-CANONICAL ===" -ForegroundColor Cyan
$knowledge = Invoke-FreeosJson -Method GET -Path "/knowledge/status"
$coverage = @($knowledge.coverage | Where-Object { $_.projectKey -eq $ProjectKey })
if ($coverage.Count -ne 1) { throw "Knowledge Governance coverage did not return $ProjectKey." }
$coverage[0] | Select-Object projectKey,projectName,baselineRecords,activeBaselineRecords,canonicalRecords,coverage | Format-Table -AutoSize
if ($coverage[0].canonicalRecords -ne 0) { throw "$ProjectKey unexpectedly gained canonical knowledge while the review is blocked." }

Write-Host "`n=== BLOCKING UNKNOWNS ===" -ForegroundColor Cyan
@($prepared.review.remainingUnknowns) | ForEach-Object { Write-Host "- $_" }

Write-Host "`nCanonical Baseline Review guard validation complete." -ForegroundColor Green
Write-Host "FREEOS refused to canonicalize a real project draft with unresolved UNKNOWNs." -ForegroundColor Green
Write-Host "The review is persistent and idempotent, but no approved-canonical knowledge was written and the learning gap remains open." -ForegroundColor Green
