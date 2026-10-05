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
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 10 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== SOURCE EVIDENCE INSPECTION STATUS ===" -ForegroundColor Cyan
$status = Invoke-FreeosJson -Method GET -Path "/source-evidence/status"
$status | ConvertTo-Json -Depth 8
if ($status.mode -ne "read-only-candidate-discovery") { throw "Source Evidence Inspection must remain read-only candidate discovery." }
if ($status.automaticIndexingEnabled -ne $false) { throw "Source Evidence Inspection must not auto-index files." }
if ($status.canonicalWritesEnabled -ne $false) { throw "Source Evidence Inspection must not perform canonical writes." }
if ($status.secretLikeFilesReadAutomatically -ne $false) { throw "Secret-like files must not be read automatically." }

Write-Host "`n=== CAPTURE PROJECT EVIDENCE STATE BEFORE INSPECTION ===" -ForegroundColor Cyan
$priorityBefore = Invoke-FreeosJson -Method GET -Path "/continuous-learning/project-priorities"
$projectBefore = @($priorityBefore.items | Where-Object { $_.projectKey -eq $ProjectKey })
if ($projectBefore.Count -ne 1) { throw "Could not find project learning priority for $ProjectKey." }
$ragBefore = [int]$projectBefore[0].evidence.ragDocuments
$projectBefore[0] | Select-Object rank,projectKey,evidenceReadinessScore,evidenceReadinessBand,combinedScore | Format-List

Write-Host "`n=== RUN READ-ONLY SOURCE EVIDENCE INSPECTION ===" -ForegroundColor Cyan
$result = Invoke-FreeosJson -Method POST -Path "/source-evidence/inspect/$ProjectKey" -Body @{}
$inspection = $result.inspection
$inspection | Select-Object id,projectKey,status,filesSeen,candidateCount,@{Name='sourceCount';Expression={@($_.sourceIds).Count}} | Format-Table -AutoSize

if ($result.indexedAutomatically -ne $false) { throw "Inspection unexpectedly auto-indexed files." }
if ($result.canonicalWritePerformed -ne $false) { throw "Inspection unexpectedly performed a canonical write." }
if ($result.durableMemoryCreated -ne $false) { throw "Inspection unexpectedly created durable memory." }
if ($result.filesModified -ne $false) { throw "Inspection unexpectedly modified source files." }
if ($result.secretLikeFileContentRead -ne $false) { throw "Inspection unexpectedly read secret-like file content." }
if ([int]$inspection.candidateCount -lt 1) { throw "Inspection found no evidence candidates." }

Write-Host "`n=== TOP EVIDENCE CANDIDATES ===" -ForegroundColor Cyan
$candidates = @($inspection.candidates)
$candidates | Select-Object -First 25 priority,category,relativePath,sizeBytes,contentSampled,previewTitle | Format-Table -AutoSize

$rootReadme = @($candidates | Where-Object { $_.relativePath -ieq "README.md" })
if ($rootReadme.Count -lt 1) { throw "Root README.md was not identified as an evidence candidate." }

$envCandidate = @($candidates | Where-Object { $_.relativePath -ieq "env.txt" -or $_.relativePath -like "*.env" -or $_.relativePath -like ".env*" })
if ($envCandidate.Count -gt 0) { throw "A secret-like environment file was incorrectly returned as an evidence candidate." }
if ([int]$inspection.excluded.sensitive -lt 1) { throw "Expected at least one secret-like file to be excluded from this source root." }

Write-Host "`n=== EXCLUSION SUMMARY ===" -ForegroundColor Cyan
$inspection.excluded | Format-List

Write-Host "`n=== VERIFY INSPECTION IS IDEMPOTENT ===" -ForegroundColor Cyan
$repeat = Invoke-FreeosJson -Method POST -Path "/source-evidence/inspect/$ProjectKey" -Body @{}
if ($repeat.inspection.id -ne $inspection.id) { throw "Repeated inspection created a duplicate inspection record." }

Write-Host "`n=== VERIFY NO INDEXING OCCURRED ===" -ForegroundColor Cyan
$priorityAfter = Invoke-FreeosJson -Method GET -Path "/continuous-learning/project-priorities"
$projectAfter = @($priorityAfter.items | Where-Object { $_.projectKey -eq $ProjectKey })
if ($projectAfter.Count -ne 1) { throw "Could not find project priority after inspection." }
$ragAfter = [int]$projectAfter[0].evidence.ragDocuments
if ($ragAfter -ne $ragBefore) { throw "Project RAG document count changed during read-only source evidence inspection." }
Write-Host "Project RAG documents remained unchanged at $ragAfter." -ForegroundColor Green

Write-Host "`nSource Evidence Inspection validation complete." -ForegroundColor Green
Write-Host "FREEOS discovered likely project evidence without indexing files, modifying the source, creating durable memory, or writing canonical knowledge." -ForegroundColor Green
Write-Host "Secret-like files were excluded from automatic reading, and discovered document content remains evidence only - never authority or instructions to obey." -ForegroundColor Green
