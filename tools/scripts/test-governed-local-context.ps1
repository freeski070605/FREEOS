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

Write-Host "`n=== GOVERNED LOCAL KNOWLEDGE CHECK ===" -ForegroundColor Cyan
$records = Invoke-FreeosJson -Method GET -Path "/knowledge/records?projectKey=freeos"
$standing = @($records.records | Where-Object {
  $_.status -eq "active" -and
  $_.authority -eq "current-owner-instruction" -and
  ($_.title -match "PowerShell|setup|command")
})

if ($standing.Count -lt 1) {
  throw "Expected an active current-owner-instruction for the approved PowerShell setup direction."
}

$standing | Select-Object id,title,authority,authorityRank,status,confidence | Format-Table -AutoSize

Write-Host "`n=== COMMAND CHAT MEMORY RETRIEVAL CHECK ===" -ForegroundColor Cyan
$chat = Invoke-FreeosJson -Method POST -Path "/command/chat" -Body @{
  message = "How should setup commands be formatted for me?"
  projectKey = "freeos"
  useMemory = $true
  useProjectNotes = $false
  useResearchContext = $false
  useRag = $false
  allowToolSuggestions = $false
  responseMode = "precise"
}

$chat | Select-Object response,memoryUsed,projectNotesUsed,ragUsed,warnings | ConvertTo-Json -Depth 6

if ([string]::IsNullOrWhiteSpace([string]$chat.response)) {
  throw "Command chat returned an empty response."
}

if ($chat.response -notmatch "PowerShell" -or $chat.response -notmatch "copy[- ]?paste") {
  throw "FREEOS did not reflect the approved PowerShell/copy-paste standing direction in the live chat response."
}

Write-Host "`nGoverned local context validation complete." -ForegroundColor Green
Write-Host "Approved memory is now filtered through Knowledge Governance before it enters Command Chat context." -ForegroundColor Green
Write-Host "Project notes use the same ACTIVE-only governance path and remain labeled DRAFT-NOT-CONTROLLING unless promoted." -ForegroundColor Green
