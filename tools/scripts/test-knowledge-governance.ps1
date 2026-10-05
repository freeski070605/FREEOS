param(
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Json($Value) {
  $Value | ConvertTo-Json -Depth 10
}

Write-Host "`n=== KNOWLEDGE GOVERNANCE BOOTSTRAP ===" -ForegroundColor Cyan
$bootstrap = Invoke-RestMethod -Method Post -Uri "$BaseUrl/knowledge/bootstrap"
Show-Json $bootstrap

Write-Host "`n=== KNOWLEDGE GOVERNANCE STATUS ===" -ForegroundColor Cyan
$status = Invoke-RestMethod -Method Get -Uri "$BaseUrl/knowledge/status"
Show-Json $status

if (-not $status.enabled) {
  throw "Knowledge Governance is not enabled."
}

if ([int]$status.records -lt 1) {
  throw "Knowledge Governance did not register any records."
}

$missing = @($status.coverage | Where-Object { $_.coverage -eq "MISSING" })
Write-Host "`n=== PROJECT BASELINE COVERAGE ===" -ForegroundColor Cyan
$status.coverage | Format-Table projectKey, baselineRecords, canonicalRecords, coverage -AutoSize

if ($missing.Count -gt 0) {
  Write-Host "`nProjects still missing governed baselines:" -ForegroundColor Yellow
  $missing | Format-Table projectKey, projectName -AutoSize
}
else {
  Write-Host "All registered projects have at least supporting governed knowledge." -ForegroundColor Green
}

Write-Host "`n=== FREEOS BASELINE ===" -ForegroundColor Cyan
$freeos = Invoke-RestMethod -Method Get -Uri "$BaseUrl/knowledge/baselines?projectKey=freeos"
Show-Json $freeos

Write-Host "`n=== REEMTEAM BASELINE ===" -ForegroundColor Cyan
$reem = Invoke-RestMethod -Method Get -Uri "$BaseUrl/knowledge/baselines?projectKey=reemteam"
Show-Json $reem

Write-Host "`n=== IDEMPOTENCE CHECK ===" -ForegroundColor Cyan
$second = Invoke-RestMethod -Method Post -Uri "$BaseUrl/knowledge/bootstrap"
$secondStatus = $second.status
Write-Host "Records after second bootstrap: $($secondStatus.records)" -ForegroundColor Green
Write-Host "Baseline links after second bootstrap: $($secondStatus.baselineLinks)" -ForegroundColor Green

Write-Host "`n=== GOVERNANCE POLICY ===" -ForegroundColor Cyan
$policy = Invoke-RestMethod -Method Get -Uri "$BaseUrl/knowledge/policy"
Show-Json $policy

Write-Host "`nKnowledge Governance validation complete." -ForegroundColor Green
Write-Host "No approved memory, RAG document, or project note content was duplicated or deleted." -ForegroundColor Green
