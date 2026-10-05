param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [switch]$CaptureToolRuns
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Json($Value) {
  $Value | ConvertTo-Json -Depth 8
}

Write-Host "`n=== EXPERIENCE LEARNING STATUS ===" -ForegroundColor Cyan
$status = Invoke-RestMethod -Method Get -Uri "$BaseUrl/experience/status"
Show-Json $status

Write-Host "`n=== RECORD REAL FREEOS EXPERIENCE ===" -ForegroundColor Cyan
$experienceBody = @{
  title = "PowerShell StrictMode broke npm.ps1"
  expectedResult = "The approved education indexing script should invoke npm and continue into RAG indexing."
  actualResult = "Windows PowerShell failed inside npm.ps1 while Set-StrictMode was active, before the npm command completed."
  outcome = "failure"
  cause = "The npm PowerShell wrapper referenced MyInvocation.Statement while inherited StrictMode treated the missing property as an error."
  evidence = "The failure occurred in C:\Program Files\nodejs\npm.ps1 during the approved education indexing run."
  candidateLesson = "In FREEOS Windows PowerShell scripts that enable Set-StrictMode, invoke npm.cmd instead of npm so the script bypasses npm.ps1 wrapper incompatibilities."
  projectKey = "freeos"
  scope = "project"
  sensitivity = "internal"
  confidence = "high"
  sourceType = "manual"
  sourceRef = "approved-education-index-strictmode"
} | ConvertTo-Json -Depth 6

$recorded = Invoke-RestMethod -Method Post -Uri "$BaseUrl/experience" -ContentType "application/json" -Body $experienceBody
Show-Json $recorded

$event = $recorded.event
if (-not $event) {
  throw "Experience API did not return an event."
}

if ($event.learningProposalId) {
  Write-Host "`nExperience already has Learning Proposal #$($event.learningProposalId)." -ForegroundColor Yellow
}
else {
  Write-Host "`n=== CREATE LEARNING PROPOSAL FROM EXPERIENCE ===" -ForegroundColor Cyan
  $proposalBody = @{
    candidateLesson = "In FREEOS Windows PowerShell scripts that enable Set-StrictMode, invoke npm.cmd instead of npm so the script bypasses npm.ps1 wrapper incompatibilities."
    whyItMatters = "This failure happened during a real FREEOS setup workflow and the npm.cmd change allowed the workflow to move past the PowerShell wrapper failure."
    confidence = "high"
    scope = "project"
  } | ConvertTo-Json -Depth 6

  $proposed = Invoke-RestMethod -Method Post -Uri "$BaseUrl/experience/$($event.id)/propose" -ContentType "application/json" -Body $proposalBody
  Show-Json $proposed
}

if ($CaptureToolRuns) {
  Write-Host "`n=== CAPTURE RECENT TOOL RUN OUTCOMES ===" -ForegroundColor Cyan
  $captureBody = @{ limit = 25 } | ConvertTo-Json
  $captured = Invoke-RestMethod -Method Post -Uri "$BaseUrl/experience/capture/tool-runs" -ContentType "application/json" -Body $captureBody
  Show-Json $captured
}

Write-Host "`n=== FINAL EXPERIENCE STATUS ===" -ForegroundColor Cyan
$finalStatus = Invoke-RestMethod -Method Get -Uri "$BaseUrl/experience/status"
Show-Json $finalStatus

Write-Host "`nExperience Learning validation complete." -ForegroundColor Green
Write-Host "Review the resulting Learning Proposal in the FREEOS Approval Hub. Durable memory still requires approval." -ForegroundColor Green
