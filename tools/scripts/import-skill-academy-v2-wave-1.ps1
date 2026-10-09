param(
  [switch]$OwnerApproved,
  [string]$BaseUrl = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$importer = Join-Path $root "tools\scripts\import-skill-teaching-pack.ps1"
if (-not (Test-Path -LiteralPath $importer -PathType Leaf)) {
  throw "Generic teaching-pack importer not found: $importer"
}

$packPaths = @(
  "curriculum\skill-academy\blender-production-core-v2.json",
  "curriculum\skill-academy\unity-production-core-v2.json",
  "curriculum\skill-academy\unreal-engine-production-core-v2.json",
  "curriculum\skill-academy\comfyui-generative-media-core-v2.json",
  "curriculum\skill-academy\adobe-premiere-pro-advanced-core-v2.json",
  "curriculum\skill-academy\adobe-after-effects-advanced-core-v2.json",
  "curriculum\skill-academy\windows-powershell-vscode-operations-core-v2.json",
  "curriculum\skill-academy\git-github-development-workflow-core-v2.json",
  "curriculum\skill-academy\ai-model-training-inference-operations-core-v2.json"
)

Write-Host "`n=== SKILL ACADEMY V2 WAVE 1 ===" -ForegroundColor Cyan
Write-Host "1. Blender Production Core v2"
Write-Host "2. Unity Production Core v2"
Write-Host "3. Unreal Engine Production Core v2"
Write-Host "4. ComfyUI & Generative Media Core v2"
Write-Host "5. Adobe Premiere Pro Advanced Core v2"
Write-Host "6. Adobe After Effects Advanced Core v2"
Write-Host "7. Windows, PowerShell & VS Code Operations Core v2"
Write-Host "8. Git & GitHub Development Workflow Core v2"
Write-Host "9. AI Model Training & Inference Operations Core v2"
Write-Host "`nExpected expansion: 72 advanced competencies, 216 training units, 72 drills across 9 existing domains." -ForegroundColor Yellow
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

& $importer -PackPath $packPaths -OwnerApproved:$OwnerApproved -BaseUrl $BaseUrl
