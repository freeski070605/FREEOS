param(
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "`n=== SKILL ACADEMY RETRIEVAL TEST ===" -ForegroundColor Cyan
$query = [uri]::EscapeDataString("How should I color correct and match three shots with different white balance and exposure?")
$result = Invoke-RestMethod -Method Get -Uri "$BaseUrl/skill-academy/context?query=$query&limit=8"

Write-Host "Retrieved units: $(@($result.items).Count)"
@($result.items) |
  Select-Object competencyKey,unitType,title,confidence,masteryLevel,riskLevel,relevance |
  Format-Table -AutoSize

if (@($result.items).Count -eq 0) { throw "Skill retrieval returned no active training units." }
if (-not ([string]$result.context).Contains("OWNER-APPROVED PRACTICAL SKILL TRAINING")) {
  throw "Skill retrieval context did not include the governed training header."
}

$colorMatches = @($result.items | Where-Object { $_.competencyKey -eq "photo-video.color-correction" })
if ($colorMatches.Count -eq 0) { throw "Color-correction training was not retrieved for a direct color-correction query." }

$nonTheory = @($result.items | Where-Object { $_.masteryLevel -ne "theory" })
if ($nonTheory.Count -ne 0) { throw "Retrieval incorrectly implies demonstrated mastery." }

Write-Host "`nSkill Academy retrieval validation passed." -ForegroundColor Green
Write-Host "Owner-approved training material is now retrievable for normal FREEOS command context without being confused with mastery." -ForegroundColor Green
