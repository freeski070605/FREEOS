param(
  [Parameter(Mandatory = $true)][string]$ProjectKey,
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [string]$EvidencePath = "README.md",
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

function Normalize-PathText {
  param([Parameter(Mandatory = $true)][string]$Path)
  return ([System.IO.Path]::GetFullPath($Path)).TrimEnd('\','/')
}

$ProjectKey = $ProjectKey.Trim()
$SourcePath = Normalize-PathText -Path $SourcePath
$EvidencePath = $EvidencePath.Trim().Replace('\','/')

if (-not $ProjectKey) { throw "ProjectKey is required." }
if (-not $EvidencePath) { throw "EvidencePath is required." }

Write-Host "`n=== VERIFY LOCAL PROJECT SOURCE ===" -ForegroundColor Cyan
Write-Host "Project: $ProjectKey"
Write-Host "Source:  $SourcePath"
Write-Host "Evidence: $EvidencePath"
if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
  throw "Project source folder does not exist: $SourcePath"
}

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
  throw "No open project-education learning gap exists for $ProjectKey. Run Continuous Learning discovery/reconcile before preparing this project."
}
$gap = $gaps[0]
$gap | Select-Object id,projectKey,signalType,priority,status,title | Format-Table -AutoSize

Write-Host "`n=== REGISTER / VERIFY READ-ONLY PROJECT SOURCE ===" -ForegroundColor Cyan
$sources = Invoke-FreeosJson -Method GET -Path "/project-sources?projectKey=$ProjectKey"
$matchingSource = @($sources.sources | Where-Object {
  $_.sourceType -eq "local-folder" -and
  (Normalize-PathText -Path ([string]$_.location)) -ieq $SourcePath
} | Select-Object -First 1)

if ($matchingSource.Count -eq 0) {
  $registered = Invoke-FreeosJson -Method POST -Path "/project-sources/$ProjectKey/register" -Body @{
    sourceType = "local-folder"
    location = $SourcePath
    label = "Primary local project source"
  }
  $source = $registered.source
} else {
  $source = $matchingSource[0]
  if ($source.enabled -ne $true) {
    $enabled = Invoke-FreeosJson -Method POST -Path "/project-sources/$($source.id)/enable" -Body @{}
    $source = $enabled.source
  }
}

$source | Select-Object id,projectKey,sourceType,label,location,available,enabled,@{Name='entryCount';Expression={@($_.topLevelEntries).Count}} | Format-Table -AutoSize
if ($source.available -ne $true) { throw "Registered source is not currently available: $SourcePath" }

Write-Host "`n=== INSPECT SOURCE EVIDENCE CANDIDATES ===" -ForegroundColor Cyan
$inspectionResult = Invoke-FreeosJson -Method POST -Path "/source-evidence/inspect/$ProjectKey" -Body @{}
$sourceInspection = $inspectionResult.inspection
$sourceInspection | Select-Object id,projectKey,status,filesSeen,candidateCount | Format-Table -AutoSize

$candidate = @($sourceInspection.candidates | Where-Object { $_.relativePath -ieq $EvidencePath } | Select-Object -First 1)
if ($candidate.Count -ne 1) {
  Write-Host "`nRequested evidence path was not discovered. Strongest candidates:" -ForegroundColor Yellow
  @($sourceInspection.candidates | Select-Object -First 20) |
    Select-Object priority,category,relativePath,sizeBytes |
    Format-Table -AutoSize
  throw "Evidence candidate '$EvidencePath' was not found. Re-run with -EvidencePath set to one of the discovered candidates."
}

$candidate[0] | Select-Object priority,category,relativePath,sizeBytes,reason | Format-List
if ($candidate[0].category -in @("untrusted-instruction-file", "operational-script")) {
  throw "Selected evidence category '$($candidate[0].category)' is intentionally not eligible for direct promotion."
}

Write-Host "`n=== EXPLICITLY PROMOTE SELECTED GOVERNED PROJECT EVIDENCE ===" -ForegroundColor Cyan
$promotionResult = Invoke-FreeosJson -Method POST -Path "/evidence-promotion/promote/$($sourceInspection.id)" -Body @{
  relativePaths = @($EvidencePath)
  createEmbeddings = $false
}

if ($promotionResult.canonicalWritePerformed -ne $false) { throw "Evidence promotion unexpectedly performed a canonical write." }
if ($promotionResult.durableMemoryCreated -ne $false) { throw "Evidence promotion unexpectedly created durable memory." }
if ($promotionResult.sourceModified -ne $false) { throw "Evidence promotion unexpectedly modified the registered source." }
if ($promotionResult.evidenceAuthority -ne "unapproved-draft") { throw "Promoted evidence received unexpected authority: $($promotionResult.evidenceAuthority)" }

$promotion = @($promotionResult.promotions | Select-Object -First 1)
if ($promotion.Count -ne 1) { throw "Expected exactly one promoted evidence result." }
$promotion[0].promotion | Select-Object id,projectKey,relativePath,category,ragDocumentId,knowledgeRecordId,status,managedPath | Format-List

Write-Host "`n=== RECORD FRESH READ-ONLY LOCAL PROJECT STATE ===" -ForegroundColor Cyan
$observation = Invoke-FreeosJson -Method POST -Path "/project-state/observe/$ProjectKey" -Body @{}
$observation.item | Select-Object id,projectKey,topic,sourceClass,confidence,status,observedAt,freshnessDays | Format-List
if ($observation.canonicalWritePerformed -ne $false) { throw "Project state observation unexpectedly performed a canonical write." }
if ($observation.durableMemoryCreated -ne $false) { throw "Project state observation unexpectedly created durable memory." }
if ($observation.sourceModified -ne $false) { throw "Project state observation unexpectedly modified the source." }

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

Write-Host "`n=== RUN GOVERNED SEMANTIC PROJECT INSPECTION ===" -ForegroundColor Cyan
$projectInspection = Invoke-FreeosJson -Method POST -Path "/project-inspection/from-work/$($work.id)" -Body @{}
$draft = $projectInspection.draft
$draft | Select-Object id,projectKey,status,learningWorkId,queueItemId,@{Name='unknownCount';Expression={@($_.unresolvedUnknowns).Count}} | Format-Table -AutoSize

if ($projectInspection.canonicalWritePerformed -ne $false) { throw "Project inspection unexpectedly performed a canonical write." }
if ($projectInspection.durableMemoryCreated -ne $false) { throw "Project inspection unexpectedly created durable memory." }
if ($projectInspection.queueResolved -ne $false) { throw "Project inspection unexpectedly resolved the project-education gap." }

Write-Host "`n=== SEMANTIC SUPPORT ===" -ForegroundColor Cyan
$semantic = $draft.evidence.semanticSupport
$semantic | Select-Object ownershipClassification,ownerDirectionEstablished,directionRecordId,@{Name='canonicalSupportingRecords';Expression={@($_.canonicalSupportingRecords).Count}} | Format-List

Write-Host "`n=== NON-BLOCKING ADVISORIES ===" -ForegroundColor Cyan
$advisories = @($draft.evidence.advisories)
if ($advisories.Count -eq 0) { Write-Host "None." } else { $advisories | ForEach-Object { Write-Host "- $_" } }

Write-Host "`n=== REMAINING SEMANTIC UNKNOWNS ===" -ForegroundColor Cyan
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
  if ($review.status -ne "pending") { throw "Semantic gaps are resolved but canonical review did not become pending." }
  if ([int]$coverage[0].canonicalRecords -ne 0) { throw "$ProjectKey became canonical before explicit owner approval." }
  Write-Host "`nProject canonical review preparation complete." -ForegroundColor Green
  Write-Host "$ProjectKey now has governed source evidence, a fresh live local-state observation, and zero semantic UNKNOWNs." -ForegroundColor Green
  Write-Host "The canonical review is PENDING explicit owner approval; this script deliberately does NOT approve it." -ForegroundColor Green
} else {
  if ($review.status -ne "blocked") { throw "Review should remain blocked while semantic UNKNOWNs exist." }
  Write-Host "`nProject canonical review preparation stopped at the correct governance gate." -ForegroundColor Yellow
  Write-Host "$ProjectKey still has $($unknowns.Count) unresolved semantic UNKNOWN(s); no canonical approval was attempted." -ForegroundColor Yellow
}
