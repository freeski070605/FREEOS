[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$freeosEnvPath = Join-Path $repoRoot ".env"

function Get-FreeOSEnvValue([string]$Name) {
    if (-not (Test-Path $freeosEnvPath)) { return $null }
    $prefix = "$Name="
    foreach ($line in Get-Content $freeosEnvPath) {
        if ($line.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $line.Substring($prefix.Length).Trim()
        }
    }
    return $null
}

function Test-Searxng([string]$BaseUrl) {
    $uri = "$($BaseUrl.TrimEnd('/'))/search?q=freeos&format=json"
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 5
            if ($null -ne $response.results) { return $true }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

$distro = Get-FreeOSEnvValue "SEARXNG_WSL_DISTRO"
$baseUrl = Get-FreeOSEnvValue "SEARXNG_BASE_URL"
if (-not $baseUrl) { $baseUrl = "http://127.0.0.1:8080" }
if (-not $distro) {
    throw "SEARXNG_WSL_DISTRO is not configured. Run npm.cmd run setup:searxng first."
}
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw "wsl.exe is unavailable."
}

$installedRaw = (& wsl.exe --list --quiet 2>&1 | Out-String) -replace "`0", ""
$installed = @($installedRaw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not ($installed -contains $distro)) {
    throw "Configured SearXNG WSL distro '$distro' is not installed."
}

& wsl.exe -d $distro -u root -- bash -lc "su -s /bin/bash -c /usr/local/bin/freeos-searxng-start searxng"
if ($LASTEXITCODE -ne 0) {
    throw "FREEOS SearXNG could not be started inside WSL."
}

if (-not (Test-Searxng -BaseUrl $baseUrl)) {
    Write-Host "SearXNG process started, but the Windows-side JSON API did not become reachable." -ForegroundColor Yellow
    Write-Host "Inspect log:" -ForegroundColor Yellow
    Write-Host "  wsl.exe -d $distro -u root -- bash -lc `"tail -n 120 /opt/freeos-searxng/searxng.log`""
    exit 1
}

Write-Host "[FREEOS] SearXNG online: $($baseUrl.TrimEnd('/'))" -ForegroundColor Green
Write-Host "[FREEOS] WSL distro: $distro"
Write-Host "[FREEOS] Docker: not used"
