param(
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Json($Value) {
  $Value | ConvertTo-Json -Depth 10
}

Write-Host "`n=== KNOWLEDGE GOVERNANCE STATUS ===" -ForegroundColor Cyan
$status = Invoke-RestMethod -Method Get -Uri "$BaseUrl/knowledge/status"
Show-Json $status

if (-not $status.enabled) {
  throw "Knowledge Governance is not enabled."
}

if ([int]$status.records -lt 1) {
  Write-Host "Knowledge Governance has no records. Bootstrapping now..." -ForegroundColor Yellow
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/knowledge/bootstrap" | Out-Null
}

Write-Host "`n=== GOVERNED REEMTEAM SEARCH ===" -ForegroundColor Cyan
$searchBody = @{
  query = "ReemTeam Pull Up To The Crib social card game table culture product"
  projectKey = "reemteam"
  mode = "keyword"
  topK = 8
} | ConvertTo-Json -Depth 6

$search = Invoke-RestMethod -Method Post -Uri "$BaseUrl/rag/search" -ContentType "application/json" -Body $searchBody
Show-Json $search

$results = @($search.results)
if ($results.Count -lt 1) {
  throw "Governed RAG search returned no results."
}

$missingGovernance = @($results | Where-Object { $null -eq $_.governance })
if ($missingGovernance.Count -gt 0) {
  throw "One or more RAG results did not include governance metadata."
}

$nonActive = @($results | Where-Object { [string]$_.governance.status -ne "active" })
if ($nonActive.Count -gt 0) {
  throw "Governed retrieval admitted a non-active knowledge record."
}

$outOfScope = @($results | Where-Object {
  $baseline = [string]$_.governance.baselineRole
  $direct = [bool]$_.governance.directProject
  $authorityRank = [int]$_.governance.authorityRank
  (-not $direct) -and [string]::IsNullOrWhiteSpace($baseline) -and $authorityRank -lt 85
})
if ($outOfScope.Count -gt 0) {
  throw "Governed retrieval admitted project-unscoped low-authority knowledge."
}

$reemCanonical = @($results | Where-Object {
  [string]$_.documentName -eq "05_REEMTEAM.md" -and
  [string]$_.governance.baselineRole -eq "canonical" -and
  [string]$_.governance.authority -eq "approved-canonical"
})

if ($reemCanonical.Count -lt 1) {
  Write-Host "ReemTeam canonical file was not in this top-K result set. Governance still passed, but review query relevance if this repeats." -ForegroundColor Yellow
}
else {
  Write-Host "ReemTeam canonical baseline retrieved with approved-canonical authority." -ForegroundColor Green
}

Write-Host "`n=== GOVERNED CONTEXT HEADER ===" -ForegroundColor Cyan
$contextBody = @{
  query = "What is ReemTeam supposed to feel like and what is the product vision?"
  projectKey = "reemteam"
  topK = 6
  includeMemory = $false
  includeProjectNotes = $false
  includeDocuments = $true
} | ConvertTo-Json -Depth 6

$context = Invoke-RestMethod -Method Post -Uri "$BaseUrl/rag/context" -ContentType "application/json" -Body $contextBody
Show-Json $context

if ([string]$context.context -notmatch "KNOWLEDGE GOVERNANCE FOR RETRIEVED DOCUMENTS") {
  throw "RAG context did not include the Knowledge Governance header."
}

if ([string]$context.context -notmatch "authority=approved-canonical") {
  throw "Governed context did not surface approved-canonical authority metadata."
}

Write-Host "`n=== GOVERNED FREEOS SEARCH ===" -ForegroundColor Cyan
$freeosBody = @{
  query = "FREEOS learning before autonomy Mission Engine institutional knowledge"
  projectKey = "freeos"
  mode = "keyword"
  topK = 8
} | ConvertTo-Json -Depth 6

$freeosSearch = Invoke-RestMethod -Method Post -Uri "$BaseUrl/rag/search" -ContentType "application/json" -Body $freeosBody
$freeosSearch.results | Select-Object documentName, score, @{n="authority";e={$_.governance.authority}}, @{n="rank";e={$_.governance.authorityRank}}, @{n="baseline";e={$_.governance.baselineRole}}, @{n="governedScore";e={$_.governance.governedScore}} | Format-Table -AutoSize

$freeosCanonical = @($freeosSearch.results | Where-Object {
  [string]$_.documentName -eq "02_FREEOS_OPERATING_MODEL.md" -and
  [string]$_.governance.baselineRole -eq "canonical"
})
if ($freeosCanonical.Count -lt 1) {
  Write-Host "FREEOS canonical operating model was not in this top-K set. Review query relevance if this repeats." -ForegroundColor Yellow
}
else {
  Write-Host "FREEOS canonical operating model retrieved as canonical baseline." -ForegroundColor Green
}

Write-Host "`nGovernance-aware retrieval validation complete." -ForegroundColor Green
Write-Host "Default RAG retrieval now admits only active governed documents and ranks project baseline/authority alongside relevance." -ForegroundColor Green
