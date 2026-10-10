[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8080",
    [string]$InstallRoot = "E:\\FREEOS_Linux"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$freeosEnvPath = Join-Path $repoRoot ".env"

function Clean-WslText([string]$Value) {
    return ($Value -replace "`0", "").Trim()
}

function Get-WslLines([string[]]$Arguments) {
    $output = (& wsl.exe @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
    $clean = Clean-WslText $output
    if ($code -ne 0) { throw "wsl.exe $($Arguments -join ' ') failed: $clean" }
    if (-not $clean) { return @() }
    return @($clean -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Normalize-WslDistroNames([string[]]$Lines) {
    $result = New-Object System.Collections.Generic.List[string]
    foreach ($raw in @($Lines)) {
        $line = Clean-WslText ([string]$raw)
        if (-not $line) { continue }

        # Newer WSL builds can emit two display columns even when --quiet is
        # requested (for example: "Ubuntu     Ubuntu"). We only want the
        # machine-readable distribution name from the first column.
        $line = $line -replace '^\*\s*', ''
        $name = (($line -split '\s{2,}', 2)[0]).Trim()
        if (-not $name) { continue }
        if ($name -match '^(NAME|DISTRIBUTION|The following|Use .+ to install)\b') { continue }
        if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { continue }
        if (-not $result.Contains($name)) { [void]$result.Add($name) }
    }
    return @($result)
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

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

function Require-WslPlatform {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        throw "wsl.exe is not available on this Windows installation."
    }

    $status = (& wsl.exe --status 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0) { return }

    if (-not (Test-Administrator)) {
        throw "WSL is not enabled yet. Open PowerShell as Administrator once, run: wsl.exe --install --no-distribution --web-download ; restart Windows if requested; then rerun npm.cmd run setup:searxng"
    }

    Write-Host "WSL platform is not ready. Enabling WSL without installing a distro on C:..." -ForegroundColor Cyan
    & wsl.exe --install --no-distribution --web-download
    if ($LASTEXITCODE -ne 0) { throw "WSL platform installation failed." }
    Write-Host "WSL components were installed. Restart Windows, then rerun npm.cmd run setup:searxng" -ForegroundColor Yellow
    exit 2
}

function Ensure-LocationSupport {
    $help = Clean-WslText ((& wsl.exe --help 2>&1 | Out-String))
    if ($help -match "--location") { return }

    Write-Host "Updating WSL so the Linux distro can be installed directly on E:..." -ForegroundColor Cyan
    & wsl.exe --update --web-download
    if ($LASTEXITCODE -ne 0) {
        throw "This WSL version does not support --location and the automatic WSL update failed. Update WSL, then rerun setup."
    }
    $help = Clean-WslText ((& wsl.exe --help 2>&1 | Out-String))
    if ($help -notmatch "--location") {
        throw "WSL still does not expose --location. FREEOS will not install a distro onto C: as a fallback."
    }
}

function Select-Distro([string[]]$Installed, [string[]]$Online, [string]$Root) {
    $configured = Get-FreeOSEnvValue "SEARXNG_WSL_DISTRO"
    if ($configured -and $Installed -contains $configured) { return $configured }

    $preferred = @("Ubuntu-24.04", "Debian", "Ubuntu-22.04", "Ubuntu")

    # Resume a distro that FREEOS already installed under the requested E: root,
    # even if a previous bootstrap failed before .env was updated.
    foreach ($candidate in $preferred) {
        if ($Installed -contains $candidate) {
            $candidatePath = Join-Path $Root $candidate
            if ((Test-Path $candidatePath) -and @(Get-ChildItem -Force $candidatePath -ErrorAction SilentlyContinue).Count -gt 0) {
                return $candidate
            }
        }
    }

    foreach ($candidate in $preferred) {
        if (($Online -contains $candidate) -and -not ($Installed -contains $candidate)) { return $candidate }
    }

    $fallback = $Online | Where-Object { $_ -match "^(Ubuntu|Debian)" -and -not ($Installed -contains $_) } | Select-Object -First 1
    if ($fallback) { return $fallback }
    throw "No unused Ubuntu/Debian WSL distribution is available for the dedicated FREEOS SearXNG install."
}

function Invoke-WslBootstrap([string]$Distro) {
    $bash = @'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  python3-dev python3-babel python3-venv python-is-python3 python3-pip \
  git build-essential libxslt1-dev zlib1g-dev libffi-dev libssl-dev \
  ca-certificates curl openssl

BASE=/opt/freeos-searxng
SRC="$BASE/src"
VENV="$BASE/venv"
SETTINGS=/etc/searxng/settings.yml

if ! id -u searxng >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$BASE" --shell /bin/bash searxng
fi
install -d -m 0755 -o searxng -g searxng "$BASE"

if [ ! -d "$SRC/.git" ]; then
  su -s /bin/bash -c "git clone --depth 1 https://github.com/searxng/searxng '$SRC'" searxng
else
  su -s /bin/bash -c "git -C '$SRC' pull --ff-only" searxng
fi

if [ ! -x "$VENV/bin/python" ]; then
  su -s /bin/bash -c "python3 -m venv '$VENV'" searxng
fi
su -s /bin/bash -c "'$VENV/bin/pip' install -U pip setuptools wheel pyyaml msgspec typing-extensions pybind11" searxng
su -s /bin/bash -c "cd '$SRC' && '$VENV/bin/pip' install --use-pep517 --no-build-isolation -e ." searxng

install -d -m 0755 /etc/searxng
if [ ! -s "$SETTINGS" ]; then
  SECRET="$(openssl rand -hex 32)"
  cat > "$SETTINGS" <<EOF
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
  bind_address: "127.0.0.1"
  port: 8080
  secret_key: "$SECRET"
  limiter: false
  image_proxy: true
EOF
  chown root:searxng "$SETTINGS"
  chmod 0640 "$SETTINGS"
fi

cat > /usr/local/bin/freeos-searxng-start <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
BASE=/opt/freeos-searxng
PID="$BASE/searxng.pid"
LOG="$BASE/searxng.log"
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
  echo "FREEOS SearXNG already running with PID $(cat "$PID")"
  exit 0
fi
rm -f "$PID"
cd "$BASE/src"
export SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml
nohup "$BASE/venv/bin/python" -m searx.webapp >>"$LOG" 2>&1 &
echo $! > "$PID"
sleep 2
if ! kill -0 "$(cat "$PID")" 2>/dev/null; then
  tail -n 80 "$LOG" || true
  exit 1
fi
echo "FREEOS SearXNG started with PID $(cat "$PID")"
EOF
chmod 0755 /usr/local/bin/freeos-searxng-start
chown -R searxng:searxng "$BASE"

su -s /bin/bash -c /usr/local/bin/freeos-searxng-start searxng
'@

    # PowerShell here-strings use Windows CRLF. Bash treats the trailing CR as
    # part of tokens such as "pipefail", producing errors like
    # ": invalid option namepefail". Normalize the entire payload to Unix LF
    # before base64 transport into WSL.
    $bash = $bash.Replace("`r`n", "`n").Replace("`r", "`n")
    $bytes = [Text.Encoding]::UTF8.GetBytes($bash)
    $encoded = [Convert]::ToBase64String($bytes)
    & wsl.exe -d $Distro -u root -- bash -lc "echo '$encoded' | base64 -d | bash"
    if ($LASTEXITCODE -ne 0) { throw "SearXNG bootstrap inside WSL failed." }
}

function Test-Searxng([string]$Url) {
    $searchUri = "$($Url.TrimEnd('/'))/search?q=freeos&format=json"
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $searchUri -Method Get -TimeoutSec 5
            if ($null -ne $response.results) { return $true }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

Write-Host "`n=== FREEOS SEARXNG WSL SETUP (NO DOCKER) ===" -ForegroundColor Cyan

$driveRoot = Split-Path -Qualifier $InstallRoot
if (-not $driveRoot -or -not (Test-Path $driveRoot)) {
    throw "Install root '$InstallRoot' is not on an available drive. FREEOS will not silently fall back to C:."
}

Require-WslPlatform
Ensure-LocationSupport

$installed = @()
try { $installed = @(Normalize-WslDistroNames (Get-WslLines @("--list", "--quiet"))) } catch { $installed = @() }
$online = @(Normalize-WslDistroNames (Get-WslLines @("--list", "--online", "--quiet")))
if (-not $online.Count) {
    throw "WSL returned no usable online distro names. Run 'wsl.exe --list --online' manually and rerun setup if the list is available."
}
$distro = Select-Distro -Installed $installed -Online $online -Root $InstallRoot
$installPath = Join-Path $InstallRoot $distro

if (-not ($installed -contains $distro)) {
    if ((Test-Path $installPath) -and @(Get-ChildItem -Force $installPath -ErrorAction SilentlyContinue).Count -gt 0) {
        throw "'$installPath' already contains files but WSL does not report '$distro' as installed. Refusing to overwrite it."
    }
    New-Item -ItemType Directory -Force -Path $installPath | Out-Null
    Write-Host "Installing $distro directly to $installPath ..." -ForegroundColor Cyan
    & wsl.exe --set-default-version 2
    if ($LASTEXITCODE -ne 0) { throw "WSL 2 could not be selected as the default version." }
    & wsl.exe --install -d $distro --location $installPath --no-launch --web-download
    if ($LASTEXITCODE -ne 0) { throw "WSL distro installation failed. Nothing was intentionally installed on C: as a fallback." }
} else {
    Write-Host "Reusing FREEOS WSL distro on E: $distro" -ForegroundColor DarkGray
}

Write-Host "Bootstrapping SearXNG inside $distro ..." -ForegroundColor Cyan
Invoke-WslBootstrap -Distro $distro

Set-FreeOSEnvValue -Name "SEARXNG_BASE_URL" -Value $BaseUrl.TrimEnd('/')
Set-FreeOSEnvValue -Name "SEARXNG_WSL_DISTRO" -Value $distro
Set-FreeOSEnvValue -Name "SEARXNG_WSL_INSTALL_ROOT" -Value $installPath

if (-not (Test-Searxng -Url $BaseUrl)) {
    Write-Host "`nSearXNG did not pass the Windows-side JSON health check." -ForegroundColor Yellow
    Write-Host "Inspect the WSL log with:" -ForegroundColor Yellow
    Write-Host "  wsl.exe -d $distro -u root -- bash -lc `"tail -n 120 /opt/freeos-searxng/searxng.log`""
    exit 1
}

Write-Host "`nSearXNG is online for FREEOS without Docker." -ForegroundColor Green
Write-Host "WSL distro: $distro"
Write-Host "Linux storage: $installPath"
Write-Host "URL: $($BaseUrl.TrimEnd('/'))"
Write-Host "JSON API: verified"
Write-Host "FREEOS .env: updated"
Write-Host "`nFuture starts:" -ForegroundColor Cyan
Write-Host "  npm.cmd run start:searxng"
Write-Host "Verify anytime:"
Write-Host "  npm.cmd run check:searxng"
