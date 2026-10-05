param(
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

  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 8 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== CREATE FRESH CURRENT INTELLIGENCE ===" -ForegroundColor Cyan
$fresh = Invoke-FreeosJson -Method POST -Path "/current-intelligence/items" -Body @{
  sourceKey = "validation-command-chat-current-intel"
  topic = "Latest FREEOS current-intelligence validation marker"
  claim = "The latest FREEOS current-intelligence validation marker is ORBIT-742."
  projectKey = "freeos"
  sourceUrl = "local://freeos/current-intelligence-chat-validation"
  sourceTitle = "FREEOS current-intelligence chat validation"
  sourceClass = "live-observation"
  confidence = "confirmed"
  evidence = "Synthetic validation evidence used only to prove Command Chat consumes fresh Current Intelligence."
  observedAt = [DateTime]::UtcNow.ToString("o")
  freshnessDays = 1
}
$fresh.item | Select-Object id,topic,status,sourceClass,confidence,observedAt,freshnessDays | Format-Table -AutoSize

Write-Host "`n=== COMMAND CHAT USES FRESH CURRENT INTELLIGENCE ===" -ForegroundColor Cyan
$chat = Invoke-FreeosJson -Method POST -Path "/command/chat" -Body @{
  message = "What is the latest FREEOS current-intelligence validation marker?"
  projectKey = "freeos"
  useMemory = $false
  useProjectNotes = $false
  useResearchContext = $false
  useCurrentIntelligence = $true
  useRag = $false
  allowToolSuggestions = $false
  responseMode = "precise"
}

$chat | Select-Object response,currentInformationSensitive,currentIntelligenceRequested,currentIntelligenceUsed,currentIntelligenceSourceCount,currentIntelligenceStaleMatchCount,currentIntelligenceRefreshNeeded,warnings | ConvertTo-Json -Depth 7

if ($chat.currentIntelligenceUsed -ne $true) { throw "Command Chat did not use fresh Current Intelligence." }
if ([int]$chat.currentIntelligenceSourceCount -lt 1) { throw "Expected at least one fresh Current Intelligence source." }
if ($chat.currentIntelligenceRefreshNeeded -ne $false) { throw "Fresh matching Current Intelligence should not require refresh." }
if ([string]$chat.response -notmatch "ORBIT-742") { throw "Command Chat did not answer from the fresh validation claim." }

Write-Host "`n=== ARCHIVE FRESH VALIDATION ITEM ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method POST -Path "/current-intelligence/items/$($fresh.item.id)/archive" -Body @{} | Out-Null

Write-Host "`n=== CREATE STALE MATCHING CURRENT INTELLIGENCE ===" -ForegroundColor Cyan
$stale = Invoke-FreeosJson -Method POST -Path "/current-intelligence/items" -Body @{
  sourceKey = "validation-command-chat-current-intel-stale"
  topic = "Latest FREEOS stale validation marker"
  claim = "The latest FREEOS stale validation marker was OLD-111."
  projectKey = "freeos"
  sourceUrl = "local://freeos/current-intelligence-chat-stale-validation"
  sourceTitle = "FREEOS stale current-intelligence validation"
  sourceClass = "live-observation"
  confidence = "confirmed"
  evidence = "Synthetic stale evidence used only to prove freshness-gap detection."
  observedAt = [DateTime]::UtcNow.AddDays(-2).ToString("o")
  freshnessDays = 1
}
$stale.item | Select-Object id,topic,status,observedAt,freshnessDays | Format-Table -AutoSize
if ($stale.item.status -ne "stale") { throw "Expected validation evidence to be stale." }

Write-Host "`n=== COMMAND CHAT FLAGS CURRENTNESS GAP ===" -ForegroundColor Cyan
$gap = Invoke-FreeosJson -Method POST -Path "/command/chat" -Body @{
  message = "What is the latest FREEOS stale validation marker?"
  projectKey = "freeos"
  useMemory = $false
  useProjectNotes = $false
  useResearchContext = $false
  useCurrentIntelligence = $true
  useRag = $false
  allowToolSuggestions = $false
  responseMode = "precise"
}

$gap | Select-Object response,currentInformationSensitive,currentIntelligenceRequested,currentIntelligenceUsed,currentIntelligenceSourceCount,currentIntelligenceStaleMatchCount,currentIntelligenceRefreshNeeded,warnings | ConvertTo-Json -Depth 7

if ($gap.currentIntelligenceUsed -ne $false) { throw "Stale evidence must not enter current Command Chat context." }
if ($gap.currentIntelligenceRefreshNeeded -ne $true) { throw "Time-sensitive query with no fresh evidence should require refresh." }
if ([int]$gap.currentIntelligenceStaleMatchCount -lt 1) { throw "Expected Command Chat to detect matching stale evidence." }

Write-Host "`n=== ARCHIVE STALE VALIDATION ITEM ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method POST -Path "/current-intelligence/items/$($stale.item.id)/archive" -Body @{} | Out-Null

Write-Host "`nCurrent Intelligence + Command Chat validation complete." -ForegroundColor Green
Write-Host "Fresh evidence enters chat context; stale evidence does not." -ForegroundColor Green
Write-Host "Time-sensitive questions expose an explicit refresh-needed signal when fresh evidence is missing." -ForegroundColor Green
