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
  if ($Method -eq "GET") { return Invoke-RestMethod -Method Get -Uri $uri }
  $json = if ($null -eq $Body) { "{}" } else { $Body | ConvertTo-Json -Depth 10 }
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "`n=== RANK OPEN PROJECT-EDUCATION GAPS ===" -ForegroundColor Cyan
$ranking = Invoke-FreeosJson -Method GET -Path "/continuous-learning/project-priorities"
$items = @($ranking.items)
if ($items.Count -lt 1) { throw "No open project-education gaps are available to rank." }

$items | Select-Object rank,projectKey,projectName,strategicRank,strategicScore,evidenceReadinessScore,evidenceReadinessBand,combinedScore | Format-Table -AutoSize
Write-Host "Weights: strategic=$($ranking.weights.strategicPriority), readiness=$($ranking.weights.evidenceReadiness)" -ForegroundColor DarkGray

for ($i = 1; $i -lt $items.Count; $i++) {
  if ([int]$items[$i].combinedScore -gt [int]$items[$i - 1].combinedScore) {
    throw "Project priority results are not sorted by combined score."
  }
}

Write-Host "`n=== EVIDENCE DETAILS ===" -ForegroundColor Cyan
foreach ($item in $items) {
  $e = $item.evidence
  Write-Host ("#{0} {1}: combined={2}; readiness={3} {4}; memories={5}; notes={6}; rag={7}; current={8}; experience={9}; research={10}; folder={11}" -f `
    $item.rank,$item.projectKey,$item.combinedScore,$item.evidenceReadinessScore,$item.evidenceReadinessBand,`
    $e.approvedMemories,$e.projectNotes,$e.ragDocuments,$e.currentIntelligence,$e.experienceEvents,$e.researchSessions,$e.folderAvailable)
}

Write-Host "`n=== DETERMINE NEXT UNWORKED PROJECT GAP ===" -ForegroundColor Cyan
$workPath = "/learning-work/items?workType=project-inspection&limit=500"
$existing = Invoke-FreeosJson -Method GET -Path $workPath
$blockedQueueIds = @{}
foreach ($work in @($existing.items)) {
  if ($work.status -eq "prepared" -or $work.status -eq "completed") {
    $blockedQueueIds[[string]$work.queueItemId] = $true
  }
}

$expected = $null
foreach ($item in $items) {
  if (-not $blockedQueueIds.ContainsKey([string]$item.queueItemId)) {
    $expected = $item
    break
  }
}

if ($null -eq $expected) {
  Write-Host "All currently ranked project gaps already have prepared/completed inspection work." -ForegroundColor Yellow
} else {
  Write-Host "Expected next project: $($expected.projectKey) (rank #$($expected.rank), combined score $($expected.combinedScore))" -ForegroundColor Green
}

Write-Host "`n=== PREPARE NEXT RANKED PROJECT WORK ===" -ForegroundColor Cyan
$prepared = Invoke-FreeosJson -Method POST -Path "/learning-work/prepare-next-project" -Body @{}

if ($null -eq $expected) {
  if ($prepared.nothingToPrepare -ne $true) { throw "Expected no unworked project gap, but work was prepared." }
} else {
  if ($prepared.nothingToPrepare -eq $true) { throw "Expected ranked project work to be prepared." }
  $prepared.prepared.work | Select-Object id,queueItemId,projectKey,workType,status,title | Format-Table -AutoSize
  if ($prepared.prepared.work.projectKey -ne $expected.projectKey) {
    throw "Prepared project '$($prepared.prepared.work.projectKey)' did not match expected ranked project '$($expected.projectKey)'."
  }
  if ($prepared.prepared.work.workType -ne "project-inspection") { throw "Ranked project work must be project-inspection work." }
  if ($prepared.prepared.work.status -ne "prepared") { throw "Ranked project work should be prepared, not executed." }
}

Write-Host "`nProject learning priority validation complete." -ForegroundColor Green
Write-Host "FREEOS ranked real project-education gaps using portfolio priority plus evidence readiness and prepared the highest-ranked gap that had not already been worked." -ForegroundColor Green
Write-Host "No inspection, canonical write, external research, or durable memory was performed by this ranking step." -ForegroundColor Green
