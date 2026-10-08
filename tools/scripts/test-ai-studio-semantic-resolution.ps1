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
  if ($Method -eq "GET") { return Invoke-RestMethod -Method Get -Uri $uri }
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 14 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== PROJECT INSPECTION SEMANTIC GAP MODEL ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/project-inspection/status"
$status | ConvertTo-Json -Depth 8
if ($status.gapModel -ne "semantic-evidence-v2") { throw "Project Inspection is not using semantic-evidence-v2." }
if ($status.storageChannelAbsenceBlocksCanonicalReview -ne $false) { throw "Missing storage channels must not block canonical review by themselves." }
if ($status.missingFirstCanonicalBaselineBlocksCanonicalReview -ne $false) { throw "The absence of a first canonical baseline must not block creating the first canonical baseline." }

Write-Host "`n=== FIND DFB AI STUDIO PROJECT INSPECTION WORK ===" -ForegroundColor Cyan
$workPath = "/learning-work/items?projectKey=$ProjectKey&workType=project-inspection&limit=50"
$workResult = Invoke-FreeosJson -Method GET -Path $workPath
$work = @($workResult.items | Where-Object { $_.status -eq "prepared" -or $_.status -eq "completed" } | Select-Object -First 1)
if ($work.Count -ne 1) { throw "No prepared/completed project-inspection work exists for $ProjectKey." }
$work[0] | Select-Object id,queueItemId,projectKey,workType,status,title | Format-Table -AutoSize

Write-Host "`n=== INSPECT SEMANTIC SUPPORT BEFORE LIVE OBSERVATION ===" -ForegroundColor Cyan
$before = Invoke-FreeosJson -Method POST -Path "/project-inspection/from-work/$($work[0].id)" -Body @{}
$before.draft | Select-Object id,projectKey,@{Name='unknownCount';Expression={@($_.unresolvedUnknowns).Count}} | Format-Table -AutoSize

$semantic = $before.draft.evidence.semanticSupport
Write-Host "Ownership classification: $($semantic.ownershipClassification)"
Write-Host "Owner direction established: $($semantic.ownerDirectionEstablished)"
Write-Host "Canonical supporting records: $(@($semantic.canonicalSupportingRecords).Count)"
if ([string]::IsNullOrWhiteSpace([string]$semantic.ownershipClassification)) { throw "Approved supporting knowledge did not establish the AI Studio organizational classification." }
if ($semantic.ownerDirectionEstablished -ne $true) { throw "Approved supporting knowledge did not establish AI Studio owner direction." }
if (@($semantic.canonicalSupportingRecords).Count -lt 1) { throw "No active controlling supporting record was found for AI Studio." }

$beforeUnknowns = @($before.draft.unresolvedUnknowns)
$badStorageBlockers = @($beforeUnknowns | Where-Object {
  $_ -match "project notes" -or
  $_ -match "approved memory" -or
  $_ -match "canonical project baseline exists"
})
if ($badStorageBlockers.Count -gt 0) { throw "Storage-channel/circular blockers are still present: $($badStorageBlockers -join '; ')" }

Write-Host "`n=== NON-BLOCKING ADVISORIES ===" -ForegroundColor Cyan
@($before.draft.evidence.advisories) | ForEach-Object { Write-Host "- $_" }

Write-Host "`n=== PROJECT STATE OBSERVATION STATUS ===" -ForegroundColor Cyan
$observationStatus = Invoke-FreeosJson -Method GET -Path "/project-state/status"
$observationStatus | ConvertTo-Json -Depth 8
if ($observationStatus.mode -ne "read-only-live-observation") { throw "Project State Observation is not read-only-live-observation." }
if ($observationStatus.sourceWritesEnabled -ne $false) { throw "Project State Observation must not write to project sources." }
if ($observationStatus.operationalHealthInferred -ne $false) { throw "Project State Observation must not infer broad operational health." }

Write-Host "`n=== RECORD FRESH LOCAL PROJECT STATE ===" -ForegroundColor Cyan
$observation = Invoke-FreeosJson -Method POST -Path "/project-state/observe/$ProjectKey" -Body @{}
$observation.item | Select-Object id,projectKey,topic,sourceClass,confidence,status,observedAt,freshnessDays | Format-List
if ($observation.item.sourceClass -ne "live-observation") { throw "Project state must enter Current Intelligence as live-observation." }
if ($observation.item.status -ne "current") { throw "Fresh project state should be current." }
if ($observation.durableMemoryCreated -ne $false) { throw "Project state observation must not create durable memory." }
if ($observation.canonicalWritePerformed -ne $false) { throw "Project state observation must not create canonical knowledge." }
if ($observation.operationalHealthInferred -ne $false) { throw "Project state observation improperly inferred operational health." }

Write-Host "`n=== RERUN AI STUDIO PROJECT INSPECTION ===" -ForegroundColor Cyan
$after = Invoke-FreeosJson -Method POST -Path "/project-inspection/from-work/$($work[0].id)" -Body @{}
$after.draft | Select-Object id,projectKey,status,@{Name='unknownCount';Expression={@($_.unresolvedUnknowns).Count}} | Format-Table -AutoSize

Write-Host "`n=== REMAINING SEMANTIC UNKNOWNS ===" -ForegroundColor Cyan
$afterUnknowns = @($after.draft.unresolvedUnknowns)
if ($afterUnknowns.Count -eq 0) {
  Write-Host "None." -ForegroundColor Green
} else {
  $afterUnknowns | ForEach-Object { Write-Host "- $_" }
}
if ($afterUnknowns.Count -ne 0) { throw "AI Studio still has unresolved semantic UNKNOWNs after approved support, governed evidence, source registration, and fresh local observation." }

Write-Host "`n=== BASELINE DRAFT PREVIEW ===" -ForegroundColor Cyan
@($after.draft.baselineDraft -split "`r?`n") | Select-Object -First 110 | ForEach-Object { Write-Host $_ }

Write-Host "`n=== PREPARE OWNER CANONICAL REVIEW ===" -ForegroundColor Cyan
$reviewResult = Invoke-FreeosJson -Method POST -Path "/project-baseline-review/prepare/$($after.draft.id)" -Body @{}
$reviewResult.review | Select-Object id,draftId,projectKey,status,@{Name='remainingUnknowns';Expression={@($_.remainingUnknowns).Count}},approvedKnowledgeRecordId | Format-Table -AutoSize
if ($reviewResult.review.status -ne "pending") { throw "AI Studio canonical review should be pending once semantic UNKNOWNs are resolved." }
if (@($reviewResult.review.remainingUnknowns).Count -ne 0) { throw "Pending review unexpectedly retained UNKNOWNs." }
if ($reviewResult.ownerApprovalRequired -ne $true) { throw "Canonical review must still require explicit owner approval." }
if ($reviewResult.canonicalWritePerformed -ne $false) { throw "Preparing review must not perform a canonical write." }

Write-Host "`n=== VERIFY AI STUDIO IS STILL NON-CANONICAL UNTIL OWNER APPROVES ===" -ForegroundColor Cyan
$governance = Invoke-FreeosJson -Method GET -Path "/knowledge/status"
$coverage = @($governance.coverage | Where-Object { $_.projectKey -eq $ProjectKey })
if ($coverage.Count -ne 1) { throw "Knowledge Governance coverage did not return $ProjectKey." }
$coverage[0] | Select-Object projectKey,projectName,baselineRecords,activeBaselineRecords,canonicalRecords,coverage | Format-Table -AutoSize
if ($coverage[0].canonicalRecords -ne 0) { throw "AI Studio became canonical without explicit owner approval." }

Write-Host "`nAI Studio semantic resolution validation complete." -ForegroundColor Green
Write-Host "FREEOS resolved real semantic gaps using approved controlling context, governed project evidence, the registered source root, and a freshness-bounded live observation." -ForegroundColor Green
Write-Host "Missing notes/memory channels and the absence of a first canonical baseline no longer create circular blockers." -ForegroundColor Green
Write-Host "The baseline is now pending owner review only; this script deliberately does NOT approve it." -ForegroundColor Green
