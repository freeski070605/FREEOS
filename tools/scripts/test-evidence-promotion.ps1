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
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 12 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== EVIDENCE PROMOTION STATUS ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/evidence-promotion/status"
$status | ConvertTo-Json -Depth 8
if ($status.mode -ne "explicit-selection-to-governed-rag") { throw "Evidence Promotion is not in explicit-selection mode." }
if ($status.automaticPromotionEnabled -ne $false) { throw "Evidence Promotion must not enable automatic promotion." }
if ($status.canonicalWritesEnabled -ne $false) { throw "Evidence Promotion must not enable canonical writes." }
if ($status.sourceWritesEnabled -ne $false) { throw "Evidence Promotion must not write to registered source roots." }

Write-Host "`n=== REFRESH CURATED SOURCE EVIDENCE INSPECTION ===" -ForegroundColor Cyan
$inspectionResult = Invoke-FreeosJson -Method POST -Path "/source-evidence/inspect/$ProjectKey" -Body @{}
$inspection = $inspectionResult.inspection
$inspection | Select-Object id,projectKey,status,filesSeen,candidateCount | Format-Table -AutoSize

$inactive = @($inspection.candidates | Where-Object { $_.relativePath -match '(^|/)_INACTIVE_' })
if ($inactive.Count -ne 0) { throw "Inactive source trees are still appearing in evidence candidates." }

$readme = @($inspection.candidates | Where-Object { $_.relativePath -ieq "README.md" } | Select-Object -First 1)
if ($readme.Count -ne 1) { throw "Root README.md was not discovered as a promotion candidate." }
if ($readme[0].priority -ne "high") { throw "Root README.md should be a high-priority project evidence candidate." }

Write-Host "`n=== CURATED TOP EVIDENCE CANDIDATES ===" -ForegroundColor Cyan
@($inspection.candidates | Select-Object -First 20) |
  Select-Object priority,category,relativePath,sizeBytes |
  Format-Table -AutoSize

Write-Host "`n=== VERIFY SOURCE FILE BEFORE PROMOTION ===" -ForegroundColor Cyan
$sourcesPath = "/project-sources?projectKey=$ProjectKey"
$sources = Invoke-FreeosJson -Method GET -Path $sourcesPath
$source = @($sources.sources | Where-Object { $_.sourceType -eq "local-folder" -and $_.available -eq $true } | Select-Object -First 1)
if ($source.Count -ne 1) { throw "No available local source root exists for $ProjectKey." }
$sourceReadme = Join-Path $source[0].location "README.md"
if (-not (Test-Path -LiteralPath $sourceReadme -PathType Leaf)) { throw "Source README.md does not exist: $sourceReadme" }
$hashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceReadme).Hash
Write-Host "Source README hash: $hashBefore" -ForegroundColor DarkGray

Write-Host "`n=== CAPTURE PROJECT RAG STATE BEFORE PROMOTION ===" -ForegroundColor Cyan
$docsBefore = @(Invoke-FreeosJson -Method GET -Path "/rag/documents?projectKey=$ProjectKey")
Write-Host "Project RAG documents before: $($docsBefore.Count)"

Write-Host "`n=== EXPLICITLY PROMOTE ROOT README EVIDENCE ===" -ForegroundColor Cyan
$promotionResult = Invoke-FreeosJson -Method POST -Path "/evidence-promotion/promote/$($inspection.id)" -Body @{
  relativePaths = @("README.md")
  createEmbeddings = $false
}

if ($promotionResult.canonicalWritePerformed -ne $false) { throw "Evidence promotion unexpectedly performed a canonical write." }
if ($promotionResult.durableMemoryCreated -ne $false) { throw "Evidence promotion unexpectedly created durable memory." }
if ($promotionResult.sourceModified -ne $false) { throw "Evidence promotion unexpectedly modified the registered source." }
if ($promotionResult.evidenceAuthority -ne "unapproved-draft") { throw "Promoted evidence must enter governance as unapproved-draft." }

$promotion = @($promotionResult.promotions | Select-Object -First 1)
if ($promotion.Count -ne 1) { throw "Expected exactly one promoted evidence item." }
$promotion[0].promotion | Select-Object id,projectKey,relativePath,category,ragDocumentId,knowledgeRecordId,status,managedPath | Format-List
if (-not (Test-Path -LiteralPath $promotion[0].promotion.managedPath -PathType Leaf)) { throw "Managed evidence snapshot was not created." }

Write-Host "`n=== VERIFY REGISTERED SOURCE WAS NOT MODIFIED ===" -ForegroundColor Cyan
$hashAfter = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceReadme).Hash
if ($hashAfter -ne $hashBefore) { throw "Registered source README.md changed during evidence promotion." }
Write-Host "Source README hash unchanged." -ForegroundColor Green

Write-Host "`n=== VERIFY GOVERNED PROJECT RAG EVIDENCE ===" -ForegroundColor Cyan
$docsAfter = @(Invoke-FreeosJson -Method GET -Path "/rag/documents?projectKey=$ProjectKey")
$promotedDoc = @($docsAfter | Where-Object { $_.id -eq $promotion[0].promotion.ragDocumentId })
if ($promotedDoc.Count -ne 1) { throw "Promoted evidence is missing from project RAG." }
$promotedDoc[0] | Select-Object id,projectKey,fileName,title,status,indexedAt | Format-Table -AutoSize

$knowledgePath = "/knowledge/records?projectKey=$ProjectKey"
$knowledge = Invoke-FreeosJson -Method GET -Path $knowledgePath
$record = @($knowledge.records | Where-Object {
  $_.sourceType -eq "rag-document" -and $_.sourceRef -eq $promotion[0].promotion.managedPath
} | Select-Object -First 1)
if ($record.Count -ne 1) { throw "Promoted RAG evidence is missing from Knowledge Governance." }
if ($record[0].authority -ne "unapproved-draft") { throw "Promoted RAG evidence unexpectedly received controlling authority." }
if ($record[0].status -ne "active") { throw "Promoted RAG evidence should be active evidence." }
$record[0] | Select-Object id,title,authority,authorityRank,status,confidence,projectKey | Format-Table -AutoSize

Write-Host "`n=== VERIFY PROMOTION IS IDEMPOTENT ===" -ForegroundColor Cyan
$repeat = Invoke-FreeosJson -Method POST -Path "/evidence-promotion/promote/$($inspection.id)" -Body @{
  relativePaths = @("README.md")
  createEmbeddings = $false
}
$repeatPromotion = @($repeat.promotions | Select-Object -First 1)
if ($repeatPromotion[0].promotion.id -ne $promotion[0].promotion.id) { throw "Repeated promotion created a duplicate promotion record." }
if ($repeatPromotion[0].promotion.ragDocumentId -ne $promotion[0].promotion.ragDocumentId) { throw "Repeated promotion created a duplicate RAG document." }

Write-Host "`n=== VERIFY PROJECT REMAINS NON-CANONICAL ===" -ForegroundColor Cyan
$governance = Invoke-FreeosJson -Method GET -Path "/knowledge/status"
$coverage = @($governance.coverage | Where-Object { $_.projectKey -eq $ProjectKey })
if ($coverage.Count -ne 1) { throw "Knowledge Governance coverage did not return $ProjectKey." }
$coverage[0] | Select-Object projectKey,projectName,baselineRecords,activeBaselineRecords,canonicalRecords,coverage | Format-Table -AutoSize
if ($coverage[0].canonicalRecords -ne 0) { throw "$ProjectKey unexpectedly became canonical through evidence promotion." }

Write-Host "`n=== VERIFY EVIDENCE READINESS INCREASED ===" -ForegroundColor Cyan
$ranking = Invoke-FreeosJson -Method GET -Path "/continuous-learning/project-priorities"
$ranked = @($ranking.items | Where-Object { $_.projectKey -eq $ProjectKey })
if ($ranked.Count -ne 1) { throw "Project priority ranking did not return $ProjectKey." }
$ranked[0] | Select-Object rank,projectKey,evidenceReadinessScore,evidenceReadinessBand,combinedScore | Format-List
if ([int]$ranked[0].evidence.ragDocuments -lt 1) { throw "Promoted evidence did not increase project RAG evidence count." }

Write-Host "`nEvidence Promotion validation complete." -ForegroundColor Green
Write-Host "FREEOS explicitly promoted selected project evidence into a managed project-scoped RAG snapshot with provenance." -ForegroundColor Green
Write-Host "The original source remained unchanged, the evidence entered governance as unapproved-draft, and no canonical knowledge or durable memory was created." -ForegroundColor Green
