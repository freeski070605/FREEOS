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

Write-Host "`n=== CURRENT INTELLIGENCE STATUS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method GET -Path "/current-intelligence/status" | ConvertTo-Json -Depth 6

Write-Host "`n=== RECORD FRESH LIVE OBSERVATION ===" -ForegroundColor Cyan
$fresh = Invoke-FreeosJson -Method POST -Path "/current-intelligence/items" -Body @{
  sourceKey = "validation-governed-local-context-fresh"
  topic = "Governed local context validation"
  claim = "FREEOS governed local context validation passed and Command Chat followed the approved PowerShell copy-paste direction with RAG disabled."
  projectKey = "freeos"
  sourceUrl = "local://freeos/test-governed-local-context"
  sourceTitle = "FREEOS local validation"
  sourceClass = "live-observation"
  confidence = "confirmed"
  evidence = "Observed from the successful tools/scripts/test-governed-local-context.ps1 validation output."
  observedAt = [DateTime]::UtcNow.ToString("o")
  freshnessDays = 1
}
$fresh.item | Select-Object id,topic,status,sourceClass,confidence,observedAt,freshnessDays | Format-Table -AutoSize
if ($fresh.item.status -ne "current") { throw "Fresh observation should be current." }
if ($fresh.durableMemoryCreated -ne $false) { throw "Current intelligence must not create durable memory automatically." }

Write-Host "`n=== RECORD EXPIRED OBSERVATION ===" -ForegroundColor Cyan
$stale = Invoke-FreeosJson -Method POST -Path "/current-intelligence/items" -Body @{
  sourceKey = "validation-current-intel-expired"
  topic = "Expired current-intelligence validation"
  claim = "This synthetic validation observation exists only to prove freshness expiration."
  projectKey = "freeos"
  sourceUrl = "local://freeos/current-intelligence-expiration-test"
  sourceTitle = "FREEOS freshness validation"
  sourceClass = "live-observation"
  confidence = "confirmed"
  evidence = "Validation-only observation; it should become stale immediately because its observation time is two days old and its freshness horizon is one day."
  observedAt = [DateTime]::UtcNow.AddDays(-2).ToString("o")
  freshnessDays = 1
}
$stale.item | Select-Object id,topic,status,observedAt,freshnessDays | Format-Table -AutoSize
if ($stale.item.status -ne "stale") { throw "Expired observation should be stale." }

Write-Host "`n=== CURRENT INTELLIGENCE CONTEXT ===" -ForegroundColor Cyan
$context = Invoke-FreeosJson -Method GET -Path "/current-intelligence/context?query=governed%20local%20context%20validation&projectKey=freeos&limit=5"
$context.items | Select-Object id,topic,status,sourceClass,authority,authorityRank,relevance | Format-Table -AutoSize
if (@($context.items).Count -lt 1) { throw "Expected the fresh validation observation in current intelligence context." }
if (@($context.items | Where-Object { $_.status -ne "current" }).Count -gt 0) { throw "Non-current intelligence leaked into current context." }
if ($context.context -notmatch "freshness-bounded") { throw "Current-intelligence context is missing freshness guidance." }

Write-Host "`n=== ARCHIVE VALIDATION RECORDS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method POST -Path "/current-intelligence/items/$($fresh.item.id)/archive" -Body @{} | Out-Null
Invoke-FreeosJson -Method POST -Path "/current-intelligence/items/$($stale.item.id)/archive" -Body @{} | Out-Null

Write-Host "`n=== FINAL CURRENT INTELLIGENCE STATUS ===" -ForegroundColor Cyan
Invoke-FreeosJson -Method GET -Path "/current-intelligence/status" | ConvertTo-Json -Depth 6

Write-Host "`nCurrent Intelligence validation complete." -ForegroundColor Green
Write-Host "Fresh observations remain current only inside their explicit freshness horizon." -ForegroundColor Green
Write-Host "Expired observations become stale and are excluded from normal current-intelligence context." -ForegroundColor Green
Write-Host "Current intelligence does not become durable memory automatically." -ForegroundColor Green
