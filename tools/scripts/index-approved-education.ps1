param(
    [switch]$SkipInventory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Invoke-Npm([string[]]$Arguments) {
    $npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source
    & $npmCmd @Arguments
    if ($LASTEXITCODE -ne 0) {
        $commandText = $Arguments -join ' '
        throw ("npm command failed with exit code {0}: npm {1}" -f $LASTEXITCODE, $commandText)
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
    throw "Could not resolve FREEOS repo root from $PSScriptRoot"
}

$knowledgeRoot = Join-Path $repoRoot 'docs\knowledge'
if (-not (Test-Path $knowledgeRoot)) {
    throw "Approved knowledge directory not found: $knowledgeRoot"
}

$expectedFiles = @(
    'README.md',
    '01_OWNER_AND_DFB_FOUNDATION.md',
    '02_FREEOS_OPERATING_MODEL.md',
    '03_DFB_SOLUTIONS.md',
    '04_ENTERTAINMENT_IP.md',
    '05_REEMTEAM.md',
    '06_DFB_SOUNDS_AND_DIGITAL_DREW.md',
    '07_TRANSPORTATION_CLIENTS_AND_INCUBATION.md',
    '08_DFB_EXECUTIVE_LAYER.md'
)

Write-Step 'VERIFY APPROVED EDUCATION FILES'
$missing = @()
foreach ($file in $expectedFiles) {
    $full = Join-Path $knowledgeRoot $file
    if (-not (Test-Path $full)) {
        $missing += $full
    }
}

if ($missing.Count -gt 0) {
    Write-Host 'Missing required files:' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    throw 'Approved education corpus is incomplete. No indexing was attempted.'
}

Write-Host "[OK] Approved education corpus present ($($expectedFiles.Count) files)." -ForegroundColor Green
Write-Host "Root: $knowledgeRoot"

Write-Step 'INDEX APPROVED EDUCATION INTO FREEOS RAG'
Invoke-Npm @('run', 'rag:index', '--', $knowledgeRoot)

Write-Step 'RAG STATUS'
Invoke-Npm @('run', 'rag:status')

if (-not $SkipInventory) {
    $inventory = Join-Path $repoRoot 'tools\scripts\knowledge-inventory.ps1'
    if (Test-Path $inventory) {
        Write-Step 'KNOWLEDGE INVENTORY'
        & $inventory
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Knowledge inventory returned exit code $LASTEXITCODE. RAG indexing already completed."
        }
    } else {
        Write-Warning "knowledge-inventory.ps1 not found; skipping inventory."
    }
}

Write-Step 'DONE'
Write-Host 'Approved DFB institutional education has been indexed into FREEOS.' -ForegroundColor Green
Write-Host 'Next implementation target: Learning Proposals -> Experience Learning -> Mission Engine v1.' -ForegroundColor Yellow
