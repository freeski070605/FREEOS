param(
  [string]$BaseUrl = "http://127.0.0.1:3001",
  [string]$ProjectKey = "dfb-ai-studio",
  [string]$SourcePath = "E:\DFB_AI_Studio"
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
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 10 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== VERIFY LOCAL PROJECT SOURCE PATH ===" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
  throw "Project source path does not exist or is not a directory: $SourcePath"
}
Write-Host "Project: $ProjectKey"
Write-Host "Source:  $SourcePath"

Write-Host "`n=== PROJECT SOURCE REGISTRY STATUS ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/project-sources/status"
$status | ConvertTo-Json -Depth 8
if ($status.automaticIndexingEnabled -ne $false) { throw "Registering a project source must not automatically index files." }
if ($status.canonicalWritesEnabled -ne $false) { throw "Registering a project source must not perform canonical writes." }

Write-Host "`n=== REGISTER READ-ONLY PROJECT SOURCE ROOT ===" -ForegroundColor Cyan
$body = @{
  sourceType = "local-folder"
  location = $SourcePath
  label = "Primary local project source"
}
$registered = Invoke-FreeosJson -Method POST -Path "/project-sources/$ProjectKey/register" -Body $body
$registered.source | Select-Object id,projectKey,sourceType,label,location,available,@{Name='entryCount';Expression={@($_.topLevelEntries).Count}} | Format-Table -AutoSize
if ($registered.indexedAutomatically -ne $false) { throw "Project source registration unexpectedly indexed files." }
if ($registered.canonicalWritePerformed -ne $false) { throw "Project source registration unexpectedly wrote canonical knowledge." }
if ($registered.source.available -ne $true) { throw "Registered local project source is not available." }
if (@($registered.source.topLevelEntries).Count -lt 1) { throw "Registered project source returned no top-level entries." }

Write-Host "`n=== VERIFY REGISTRATION IS IDEMPOTENT ===" -ForegroundColor Cyan
$repeat = Invoke-FreeosJson -Method POST -Path "/project-sources/$ProjectKey/register" -Body $body
if ($repeat.source.id -ne $registered.source.id) { throw "Registering the same source root created a duplicate source." }

Write-Host "`n=== VERIFY PROJECT LEARNING READINESS UPDATED ===" -ForegroundColor Cyan
$ranking = Invoke-FreeosJson -Method GET -Path "/continuous-learning/project-priorities"
$item = @($ranking.items | Where-Object { $_.projectKey -eq $ProjectKey })
if ($item.Count -ne 1) { throw "Project learning ranking did not return $ProjectKey." }
$item[0] | Select-Object rank,projectKey,strategicRank,evidenceReadinessScore,evidenceReadinessBand,combinedScore,@{Name='sourceRoots';Expression={$_.evidence.availableSourceRoots}},nextAction | Format-List
if ([int]$item[0].evidence.availableSourceRoots -lt 1) { throw "Registered source root did not enter readiness evidence." }
if ([int]$item[0].evidenceReadinessScore -lt 20) { throw "Project evidence readiness did not increase after source registration." }

Write-Host "`n=== SOURCE ROOT PREVIEW ===" -ForegroundColor Cyan
@($registered.source.topLevelEntries) | Select-Object -First 40 | ForEach-Object { Write-Host "- $_" }

Write-Host "`nProject Source Registry validation complete." -ForegroundColor Green
Write-Host "FREEOS now knows where the real project source lives without indexing it or treating file existence as canonical truth." -ForegroundColor Green
Write-Host "The source root now contributes to evidence readiness and is available for the next read-only source-evidence inspection step." -ForegroundColor Green
