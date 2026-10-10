param(
    [switch]$Remote
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DriveRoot = [System.IO.Path]::GetPathRoot($RepoRoot)
if (-not $DriveRoot) { throw "Could not determine FREEOS drive root." }

$RuntimeRoot = Join-Path $DriveRoot "FREEOS_Data"
$TempRoot = Join-Path $RuntimeRoot "temp"
$NpmCacheRoot = Join-Path $RuntimeRoot "npm-cache"
New-Item -ItemType Directory -Force -Path $TempRoot, $NpmCacheRoot | Out-Null

# Keep FREEOS runtime scratch and npm cache off a constrained Windows system drive.
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
$env:NPM_CONFIG_CACHE = $NpmCacheRoot

$Concurrently = Join-Path $RepoRoot "node_modules\.bin\concurrently.cmd"
if (-not (Test-Path $Concurrently)) {
    throw "FREEOS dependencies are not installed. Expected $Concurrently"
}

Write-Host "FREEOS runtime temp: $TempRoot" -ForegroundColor Cyan
Write-Host "FREEOS npm cache:   $NpmCacheRoot" -ForegroundColor Cyan

Push-Location $RepoRoot
try {
    if ($Remote) {
        & $Concurrently -n API,REMOTE -c cyan,magenta "npm.cmd run dev:api" "npm.cmd run dev:remote --workspace @freeos/dashboard"
    }
    else {
        & $Concurrently -n API,DASHBOARD -c cyan,magenta "npm.cmd run dev:api" "npm.cmd run dev:dashboard"
    }
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
