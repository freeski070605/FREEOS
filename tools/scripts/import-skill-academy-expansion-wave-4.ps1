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
  "curriculum\skill-academy\blender-production-core-v1.json",
  "curriculum\skill-academy\unity-production-core-v1.json",
  "curriculum\skill-academy\unreal-engine-production-core-v1.json",
  "curriculum\skill-academy\comfyui-generative-media-core-v1.json",
  "curriculum\skill-academy\git-github-development-workflow-core-v1.json",
  "curriculum\skill-academy\digital-asset-pipeline-interchange-core-v1.json",
  "curriculum\skill-academy\gis-photogrammetry-3d-worldbuilding-core-v1.json"
)

Write-Host "`n=== SKILL ACADEMY EXPANSION WAVE 4 ===" -ForegroundColor Cyan
Write-Host "1. Blender Production Core v1"
Write-Host "2. Unity Production Core v1"
Write-Host "3. Unreal Engine Production Core v1"
Write-Host "4. ComfyUI & Generative Media Core v1"
Write-Host "5. Git & GitHub Development Workflow Core v1"
Write-Host "6. Digital Asset Pipeline & Interchange Core v1"
Write-Host "7. GIS, Photogrammetry & 3D Worldbuilding Core v1"
Write-Host "`nExpected expansion: 56 competencies, 168 training units, 56 drills." -ForegroundColor Yellow
Write-Host "OwnerApproved: $([bool]$OwnerApproved)"

& $importer -PackPath $packPaths -OwnerApproved:$OwnerApproved -BaseUrl $BaseUrl
