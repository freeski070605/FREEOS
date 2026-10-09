param(
  [string]$HostAddress = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envPath = Join-Path $root ".env"

function Resolve-TailscaleExecutable {
  $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  return $null
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
  $pattern = "^" + [regex]::Escape($Key) + "="
  $updated = $false
  $next = foreach ($line in $lines) {
    if ($line -match $pattern) {
      if (-not $updated) { "$Key=$Value"; $updated = $true }
    } else { $line }
  }
  if (-not $updated) { $next = @($next) + "$Key=$Value" }
  Set-Content -LiteralPath $Path -Value $next -Encoding UTF8
}

$tailscale = Resolve-TailscaleExecutable
if (-not $tailscale -and -not $HostAddress) {
  Write-Host "Tailscale is not installed or not on PATH." -ForegroundColor Yellow
  Write-Host "Install Tailscale on this PC and your phone, sign both into the same tailnet, then rerun this script."
  Write-Host "FREEOS will not expose API port 3001 directly; the remote dashboard proxies to the loopback API."
  exit 2
}

if (-not $HostAddress) {
  $addresses = @(& $tailscale ip -4 2>$null) | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d{1,3}(?:\.\d{1,3}){3}$' }
  $HostAddress = @($addresses | Where-Object { $_ -like '100.*' } | Select-Object -First 1)[0]
  if (-not $HostAddress) { $HostAddress = @($addresses | Select-Object -First 1)[0] }
}

if (-not $HostAddress -or $HostAddress -notmatch '^\d{1,3}(?:\.\d{1,3}){3}$') {
  throw "Could not determine a Tailscale IPv4 address. Make sure Tailscale is connected, or pass -HostAddress explicitly."
}

Set-EnvValue -Path $envPath -Key "REMOTE_OPS_HOST" -Value $HostAddress

Write-Host "`n=== FREEOS REMOTE OPS READY ===" -ForegroundColor Cyan
Write-Host "Private dashboard host: $HostAddress"
Write-Host "Saved REMOTE_OPS_HOST to: $envPath"
Write-Host "API exposure: loopback only (127.0.0.1:3001)" -ForegroundColor Green
Write-Host "Dashboard exposure: Tailscale address only ($HostAddress`:5173)" -ForegroundColor Green
Write-Host "`nStart FREEOS in remote mode:" -ForegroundColor Yellow
Write-Host "  cd $root"
Write-Host "  npm.cmd run dev:remote"
Write-Host "`nThen, while your phone is connected to the same Tailscale tailnet, open:" -ForegroundColor Yellow
Write-Host "  http://$HostAddress`:5173"
Write-Host "`nDo not port-forward 5173 or 3001 on your router. Remote access is intended to stay inside Tailscale."
