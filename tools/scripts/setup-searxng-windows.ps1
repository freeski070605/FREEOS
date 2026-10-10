[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8080"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtimeDir = Join-Path $repoRoot "data\searxng"
$coreConfigDir = Join-Path $runtimeDir "core-config"
$composePath = Join-Path $runtimeDir "docker-compose.yml"
$serviceEnvPath = Join-Path $runtimeDir ".env"
$settingsPath = Join-Path $coreConfigDir "settings.yml"
$freeosEnvPath = Join-Path $repoRoot ".env"

function Require-Docker {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        throw "Docker was not found. Install/start Docker Desktop first, then rerun: npm.cmd run setup:searxng"
    }

    & docker version --format '{{.Server.Version}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is installed but the Docker engine is not running. Start Docker Desktop, wait for the engine to be ready, then rerun this command."
    }

    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is unavailable. Update Docker Desktop, then rerun this command."
    }
}

function New-Secret {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    return ([Convert]::ToHexString($bytes)).ToLowerInvariant()
}

function Set-FreeOSEnvValue([string]$Name, [string]$Value) {
    if (-not (Test-Path $freeosEnvPath)) {
        Set-Content -Path $freeosEnvPath -Value "$Name=$Value" -Encoding UTF8
        return
    }

    $lines = @(Get-Content $freeosEnvPath)
    $pattern = "^" + [Regex]::Escape($Name) + "="
    $updated = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $lines[$i] = "$Name=$Value"
            $updated = $true
            break
        }
    }
    if (-not $updated) { $lines += "$Name=$Value" }
    Set-Content -Path $freeosEnvPath -Value $lines -Encoding UTF8
}

Write-Host "`n=== FREEOS SEARXNG SETUP ===" -ForegroundColor Cyan
Require-Docker

New-Item -ItemType Directory -Force -Path $coreConfigDir | Out-Null

Write-Host "Fetching current official SearXNG container template..." -ForegroundColor Cyan
Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/searxng/searxng/master/container/docker-compose.yml" `
    -OutFile $composePath `
    -UseBasicParsing

if (-not (Test-Path $serviceEnvPath)) {
    $secret = New-Secret
    @(
        "SEARXNG_VERSION=latest"
        "SEARXNG_HOST=127.0.0.1"
        "SEARXNG_PORT=8080"
        "SEARXNG_BASE_URL=$BaseUrl/"
        "SEARXNG_SECRET=$secret"
        "SEARXNG_LIMITER=false"
        "SEARXNG_VALKEY_URL=valkey://valkey:6379/0"
    ) | Set-Content -Path $serviceEnvPath -Encoding UTF8
    Write-Host "Created private local SearXNG environment configuration." -ForegroundColor Green
} else {
    Write-Host "Keeping existing SearXNG .env configuration." -ForegroundColor DarkGray
}

if (-not (Test-Path $settingsPath)) {
    @'
use_default_settings: true

general:
  debug: false
  instance_name: "FREEOS SearXNG"

search:
  safe_search: 0
  formats:
    - html
    - json

server:
  limiter: false
  image_proxy: true

valkey:
  url: valkey://valkey:6379/0
'@ | Set-Content -Path $settingsPath -Encoding UTF8
    Write-Host "Created SearXNG settings with JSON search enabled." -ForegroundColor Green
} else {
    $settings = Get-Content $settingsPath -Raw
    if ($settings -notmatch '(?m)^\s*-\s*json\s*$') {
        throw "Existing $settingsPath does not visibly enable the json search format. Add 'json' under search.formats, then rerun."
    }
    Write-Host "Existing settings already expose JSON search." -ForegroundColor DarkGray
}

Write-Host "Starting SearXNG + Valkey containers..." -ForegroundColor Cyan
Push-Location $runtimeDir
try {
    & docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw "docker compose up -d failed." }
} finally {
    Pop-Location
}

$searchUri = "$($BaseUrl.TrimEnd('/'))/search?q=freeos&format=json"
$online = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $response = Invoke-RestMethod -Uri $searchUri -Method Get -TimeoutSec 5
        if ($null -ne $response.results) {
            $online = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $online) {
    Write-Host "`nSearXNG did not pass its JSON health check yet." -ForegroundColor Yellow
    Write-Host "Inspect it with:" -ForegroundColor Yellow
    Write-Host "  cd `"$runtimeDir`""
    Write-Host "  docker compose ps"
    Write-Host "  docker compose logs core --tail 100"
    exit 1
}

Set-FreeOSEnvValue -Name "SEARXNG_BASE_URL" -Value $BaseUrl.TrimEnd('/')

Write-Host "`nSearXNG is online for FREEOS." -ForegroundColor Green
Write-Host "URL: $($BaseUrl.TrimEnd('/'))"
Write-Host "JSON API: verified"
Write-Host "Exposure: loopback only (127.0.0.1)"
Write-Host "FREEOS .env: SEARXNG_BASE_URL updated"
Write-Host "`nVerify anytime with:" -ForegroundColor Cyan
Write-Host "  npm.cmd run check:searxng"
