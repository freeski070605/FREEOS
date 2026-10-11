param([string]$ProjectRoot = "", [string]$MediaRoot = "", [string]$BindAddress = "127.0.0.1")
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $repo '.env'
if (-not (Test-Path -LiteralPath $envPath)) { Copy-Item -LiteralPath (Join-Path $repo '.env.example') -Destination $envPath }
function Set-EnvValue([string]$Name, [string]$Value) {
  $lines = @(Get-Content -LiteralPath $envPath)
  $found = @($lines | Where-Object { $_ -match "^$([regex]::Escape($Name))=" }).Count -gt 0
  $updated = @($lines | ForEach-Object { if ($_ -match "^$([regex]::Escape($Name))=") { "$Name=$Value" } else { $_ } })
  if (-not $found) { $updated += "$Name=$Value" }
  [System.IO.File]::WriteAllLines($envPath, $updated)
}
function Find-Adobe([string]$Name) {
  $root = 'C:\Program Files\Adobe'
  if (-not (Test-Path -LiteralPath $root)) { return '' }
  $found = Get-ChildItem -LiteralPath $root -Filter $Name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  return ''
}
function New-Token { $bytes = New-Object byte[] 48; $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }; return [Convert]::ToBase64String($bytes) -replace '\+','-' -replace '/','_' -replace '=','' }
Set-EnvValue 'FREEOS_ADOBE_ENABLED' 'true'
Set-EnvValue 'FREEOS_ADOBE_WORKER_MODE' 'worker'
Set-EnvValue 'FREEOS_ADOBE_WORKER_HOST' $BindAddress
Set-EnvValue 'FREEOS_ADOBE_WORKER_PORT' '4318'
Set-EnvValue 'FREEOS_PREMIERE_PATH' (Find-Adobe 'Adobe Premiere Pro.exe')
Set-EnvValue 'FREEOS_AFTER_EFFECTS_PATH' (Find-Adobe 'AfterFX.exe')
Set-EnvValue 'FREEOS_MEDIA_ENCODER_PATH' (Find-Adobe 'Adobe Media Encoder.exe')
function Resolve-Roots([string]$Roots) {
  return (($Roots -split ';' | Where-Object { $_.Trim() } | ForEach-Object { [System.IO.Path]::GetFullPath($_.Trim()) }) -join ';')
}
if ($ProjectRoot) { Set-EnvValue 'FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS' (Resolve-Roots $ProjectRoot) }
if ($MediaRoot) { Set-EnvValue 'FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS' (Resolve-Roots $MediaRoot) }
$contents = Get-Content -LiteralPath $envPath -Raw
if ($contents -notmatch '(?m)^FREEOS_ADOBE_WORKER_TOKEN=\S+') { Set-EnvValue 'FREEOS_ADOBE_WORKER_TOKEN' (New-Token) }
if ($contents -notmatch '(?m)^FREEOS_ADOBE_BRIDGE_TOKEN=\S+') { Set-EnvValue 'FREEOS_ADOBE_BRIDGE_TOKEN' (New-Token) }
Write-Host "Adobe worker configuration written to $envPath. Tokens were not printed. Configure TLS and LAN host before remote use."
Write-Host 'Detected Adobe applications:'
Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^FREEOS_(PREMIERE|AFTER_EFFECTS|MEDIA_ENCODER)_PATH=' }
