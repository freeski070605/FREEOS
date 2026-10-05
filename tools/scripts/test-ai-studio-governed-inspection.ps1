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

Write-Host "`n=== VERIFY GOVERNED PROMOTED PROJECT EVIDENCE EXISTS ===" -ForegroundColor Cyan
$promotionPath = "/evidence-promotion/items?projectKey=$ProjectKey"
$promotions = Invoke-FreeosJson -Method GET -Path $promotionPath
$promotionItems = @($promotions.items)
if ($promotionItems.Count -lt 1) { throw "No promoted project evidence exists for $ProjectKey." }
$promotionItems | Select-Object id,relativePath,category,ragDocumentId,knowledgeRecordId,status | Format-Table -AutoSize

Write-Host "`n=== FIND PROJECT INSPECTION LEARNING WORK ===" -ForegroundColor Cyan
$workPath = "/learning-work/items?workType=project-inspection&projectKey=$ProjectKey&limit=100"
$workResponse = Invoke-FreeosJson -Method GET -Path $workPath
$work = @($workResponse.items | Where-Object { $_.status -eq "prepared" } | Select-Object -First 1)
if ($work.Count -eq 0) {
  $work = @($workResponse.items | Where-Object { $_.status -eq "completed" } | Select-Object -First 1)
}
if ($work.Count -eq 0) {
  $queuePath = "/continuous-learning/queue?status=open&signalType=project-education&projectKey=$ProjectKey&limit=20"
  $queue = Invoke-FreeosJson -Method GET -Path $queuePath
  $gap = @($queue.items | Select-Object -First 1)
  if ($gap.Count -ne 1) { throw "No project-inspection work or open project-education gap exists for $ProjectKey." }
  $prepared = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare/$($gap[0].id)" -Body @{}
  $work = @($prepared.work)
}
$work[0] | Select-Object id,queueItemId,projectKey,workType,status,title | Format-Table -AutoSize

Write-Host "`n=== RERUN PROJECT INSPECTION WITH GOVERNED EVIDENCE ===" -ForegroundColor Cyan
$inspection = Invoke-FreeosJson -Method POST -Path "/project-inspection/from-work/$($work[0].id)" -Body @{}
$inspection.draft | Select-Object id,projectKey,status,learningWorkId,queueItemId,@{Name='unknownCount';Expression={@($_.unresolvedUnknowns).Count}} | Format-Table -AutoSize

if ($inspection.canonicalWritePerformed -ne $false) { throw "Project Inspection unexpectedly performed a canonical write." }
if ($inspection.durableMemoryCreated -ne $false) { throw "Project Inspection unexpectedly created durable memory." }
if ($inspection.queueResolved -ne $false) { throw "Project Inspection unexpectedly resolved the canonical project-learning gap." }
if ($inspection.draft.projectKey -ne $ProjectKey) { throw "Project Inspection returned the wrong project." }
if ($inspection.draft.baselineDraft -notmatch "DRAFT.*NOT CANONICAL") { throw "Project baseline draft is missing its non-canonical warning." }

Write-Host "`n=== GOVERNED EVIDENCE COUNTS ===" -ForegroundColor Cyan
$counts = $inspection.draft.evidence.counts
$counts | Format-List
if ([int]$counts.projectRagDocuments -lt 1) { throw "Inspection did not recognize any active governed project RAG evidence." }
if ([int]$counts.registeredAvailableSourceRoots -lt 1) { throw "Inspection did not recognize the registered real project source root." }
if ([int]$counts.projectRagDocumentsAll -lt [int]$counts.projectRagDocuments) { throw "Governed RAG count cannot exceed raw indexed project document count." }

Write-Host "`n=== GOVERNED PROJECT EVIDENCE ===" -ForegroundColor Cyan
$governedDocs = @($inspection.draft.evidence.ragDocuments)
$governedDocs | Select-Object id,title,fileName,authority,authorityRank,governanceStatus,confidence,knowledgeRecordId | Format-Table -AutoSize
if (@($governedDocs | Where-Object { $_.authority -eq "unapproved-draft" -and $_.governanceStatus -eq "active" }).Count -lt 1) {
  throw "Expected promoted evidence to appear as active unapproved-draft governed evidence."
}

Write-Host "`n=== FIRST GOVERNED EVIDENCE EXCERPT ===" -ForegroundColor Cyan
$firstExcerpt = @($governedDocs | Where-Object { $_.firstChunkExcerpt } | Select-Object -First 1)
if ($firstExcerpt.Count -eq 1) {
  Write-Host $firstExcerpt[0].firstChunkExcerpt
} else {
  Write-Host "No chunk excerpt was available; metadata-only evidence remains registered." -ForegroundColor Yellow
}

Write-Host "`n=== VERIFY OLD SOURCE GAPS ARE GONE ===" -ForegroundColor Cyan
$unknowns = @($inspection.draft.unresolvedUnknowns)
$unknowns | ForEach-Object { Write-Host "- $_" }
if (@($unknowns | Where-Object { $_ -match "No active governed project-scoped RAG evidence" }).Count -ne 0) {
  throw "Governed RAG evidence gap remained after evidence promotion."
}
if (@($unknowns | Where-Object { $_ -match "No available real project source root" }).Count -ne 0) {
  throw "Project source-root gap remained after source registration."
}

Write-Host "`n=== BASELINE DRAFT PREVIEW ===" -ForegroundColor Cyan
@($inspection.draft.baselineDraft -split "`r?`n") | Select-Object -First 90 | ForEach-Object { Write-Host $_ }

Write-Host "`n=== VERIFY INSPECTION REMAINS IDEMPOTENT ===" -ForegroundColor Cyan
$repeat = Invoke-FreeosJson -Method POST -Path "/project-inspection/from-work/$($work[0].id)" -Body @{}
if ($repeat.draft.id -ne $inspection.draft.id) { throw "Repeated governed project inspection created a duplicate draft." }

Write-Host "`n=== PREPARE AI STUDIO CANONICAL REVIEW ===" -ForegroundColor Cyan
$review = Invoke-FreeosJson -Method POST -Path "/project-baseline-review/prepare/$($inspection.draft.id)" -Body @{}
$review.review | Select-Object id,draftId,projectKey,status,@{Name='remainingUnknowns';Expression={@($_.remainingUnknowns).Count}},approvedKnowledgeRecordId | Format-Table -AutoSize
if ($review.canonicalWritePerformed -ne $false) { throw "Preparing AI Studio canonical review unexpectedly performed a canonical write." }
if ($review.review.status -ne "blocked") { throw "AI Studio canonical review should remain blocked until remaining UNKNOWNs are resolved." }
if (@($review.review.remainingUnknowns).Count -lt 1) { throw "This stage expects unresolved AI Studio baseline questions to remain." }

Write-Host "`n=== VERIFY AI STUDIO REMAINS NON-CANONICAL ===" -ForegroundColor Cyan
$governance = Invoke-FreeosJson -Method GET -Path "/knowledge/status"
$coverage = @($governance.coverage | Where-Object { $_.projectKey -eq $ProjectKey })
if ($coverage.Count -ne 1) { throw "Knowledge Governance coverage did not return $ProjectKey." }
$coverage[0] | Select-Object projectKey,projectName,baselineRecords,activeBaselineRecords,canonicalRecords,coverage | Format-Table -AutoSize
if ([int]$coverage[0].canonicalRecords -ne 0) { throw "$ProjectKey unexpectedly became canonical." }

Write-Host "`n=== VERIFY READINESS COUNTS ONLY GOVERNED RAG EVIDENCE ===" -ForegroundColor Cyan
$ranking = Invoke-FreeosJson -Method GET -Path "/continuous-learning/project-priorities"
$ranked = @($ranking.items | Where-Object { $_.projectKey -eq $ProjectKey })
if ($ranked.Count -ne 1) { throw "Project priority ranking did not return $ProjectKey." }
$ranked[0] | Select-Object rank,projectKey,evidenceReadinessScore,evidenceReadinessBand,combinedScore,@{Name='governedRag';Expression={$_.evidence.ragDocuments}},@{Name='rawRag';Expression={$_.evidence.rawRagDocuments}},@{Name='sourceRoots';Expression={$_.evidence.availableSourceRoots}} | Format-List
if ([int]$ranked[0].evidence.ragDocuments -lt 1) { throw "Readiness did not count promoted governed RAG evidence." }
if ([int]$ranked[0].evidence.rawRagDocuments -lt [int]$ranked[0].evidence.ragDocuments) { throw "Raw RAG count cannot be lower than governed RAG count." }

Write-Host "`nAI Studio governed Project Inspection validation complete." -ForegroundColor Green
Write-Host "FREEOS reran the real AI Studio project inspection using active governed promoted evidence and the registered source root." -ForegroundColor Green
Write-Host "The old evidence/source gaps cleared, remaining UNKNOWNs stayed explicit, and canonical review remained blocked without owner approval." -ForegroundColor Green
