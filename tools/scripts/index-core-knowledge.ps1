param(
    [string]$ApiBase = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$core = Join-Path $Root "data\documents\core"

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host "       FREEOS CORE KNOWLEDGE INDEX       " -ForegroundColor Cyan
Write-Host "=========================================`n" -ForegroundColor Cyan

if (-not (Test-Path $core)) {
    throw "Core Knowledge folder missing: $core"
}

try {
    Invoke-RestMethod `
        -Uri "$ApiBase/rag/status" `
        -Method Get `
        -TimeoutSec 10 | Out-Null
}
catch {
    throw "FREEOS API is not reachable at $ApiBase. Start FREEOS first."
}

$sourcePayload = @{
    sourceKey   = "core-knowledge"
    displayName = "FREEOS Core Knowledge"
    rootPath    = $core
    sourceType  = "root"
} | ConvertTo-Json

Write-Host "Registering GLOBAL Core Knowledge source..." -ForegroundColor Cyan

Invoke-RestMethod `
    -Uri "$ApiBase/rag/sources" `
    -Method Post `
    -ContentType "application/json" `
    -Body $sourcePayload | Out-Null

$indexPayload = @{
    rootPath   = $core
    sourceKey  = "core-knowledge"
    force      = $true
    embeddings = $true
} | ConvertTo-Json

Write-Host "Indexing and embedding Core Knowledge..." -ForegroundColor Cyan

$result = Invoke-RestMethod `
    -Uri "$ApiBase/rag/index" `
    -Method Post `
    -ContentType "application/json" `
    -Body $indexPayload `
    -TimeoutSec 300

Write-Host "`nIndex job:" -ForegroundColor Green
$result | ConvertTo-Json -Depth 10

Write-Host "`nCurrent RAG status:" -ForegroundColor Cyan

$status = Invoke-RestMethod `
    -Uri "$ApiBase/rag/status" `
    -Method Get

$status | ConvertTo-Json -Depth 10

Write-Host "`nCore Knowledge indexing complete." -ForegroundColor Green
