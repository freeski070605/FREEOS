param(
  [switch]$EnableComputerControl = $true,
  [switch]$EnableScreenCapture = $true
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  $example = Join-Path $root ".env.example"
  if (-not (Test-Path -LiteralPath $example -PathType Leaf)) { throw "Neither .env nor .env.example exists." }
  Copy-Item -LiteralPath $example -Destination $envPath
}

function Set-DotEnvValue([string]$Key, [string]$Value) {
  $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $envPath)
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($Key))=") {
      $lines[$i] = "$Key=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) { $lines.Add("$Key=$Value") }
  [IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
}

function First-File([string[]]$Candidates) {
  foreach ($candidate in $Candidates) {
    if (-not $candidate) { continue }
    if ($candidate -match '[*?]') {
      $match = Get-ChildItem -Path $candidate -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
      if ($match) { return $match.FullName }
    } elseif (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

$programFiles = $env:ProgramFiles
$programFilesX86 = ${env:ProgramFiles(x86)}
$local = $env:LOCALAPPDATA

$apps = @(
  @{ Key='FREEOS_OPERATOR_BLENDER_EXE'; Name='Blender'; Paths=@("$programFiles\Blender Foundation\Blender *\blender.exe") },
  @{ Key='FREEOS_OPERATOR_PREMIERE_EXE'; Name='Premiere Pro'; Paths=@("$programFiles\Adobe\Adobe Premiere Pro *\Adobe Premiere Pro.exe") },
  @{ Key='FREEOS_OPERATOR_AFTER_EFFECTS_EXE'; Name='After Effects'; Paths=@("$programFiles\Adobe\Adobe After Effects *\Support Files\AfterFX.exe") },
  @{ Key='FREEOS_OPERATOR_PHOTOSHOP_EXE'; Name='Photoshop'; Paths=@("$programFiles\Adobe\Adobe Photoshop *\Photoshop.exe") },
  @{ Key='FREEOS_OPERATOR_LIGHTROOM_EXE'; Name='Lightroom Classic'; Paths=@("$programFiles\Adobe\Adobe Lightroom Classic\Lightroom.exe", "$programFiles\Adobe\Adobe Lightroom Classic *\Lightroom.exe") },
  @{ Key='FREEOS_OPERATOR_UNITY_EXE'; Name='Unity'; Paths=@("$programFiles\Unity\Hub\Editor\*\Editor\Unity.exe") },
  @{ Key='FREEOS_OPERATOR_UNREAL_EXE'; Name='Unreal Engine'; Paths=@("$programFiles\Epic Games\UE_*\Engine\Binaries\Win64\UnrealEditor.exe") },
  @{ Key='FREEOS_OPERATOR_COMFYUI_EXE'; Name='ComfyUI Desktop'; Paths=@("$local\Programs\ComfyUI\ComfyUI.exe", "$programFiles\ComfyUI\ComfyUI.exe") },
  @{ Key='FREEOS_OPERATOR_OBS_EXE'; Name='OBS Studio'; Paths=@("$programFiles\obs-studio\bin\64bit\obs64.exe", "$programFilesX86\obs-studio\bin\32bit\obs32.exe") },
  @{ Key='FREEOS_OPERATOR_VSCODE_EXE'; Name='VS Code'; Paths=@("$local\Programs\Microsoft VS Code\Code.exe", "$programFiles\Microsoft VS Code\Code.exe") }
)

if ($EnableComputerControl) { Set-DotEnvValue 'COMPUTER_CONTROL_ENABLED' 'true' }
if ($EnableScreenCapture) { Set-DotEnvValue 'COMPUTER_SCREEN_CAPTURE_ENABLED' 'true' }

$found = @()
$missing = @()
foreach ($app in $apps) {
  $path = First-File $app.Paths
  if ($path) {
    Set-DotEnvValue $app.Key $path
    $found += [pscustomobject]@{ Operator=$app.Name; Status='configured'; Path=$path }
  } else {
    $existing = (Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^$([regex]::Escape($app.Key))=" } | Select-Object -First 1)
    $value = if ($existing) { ($existing -split '=',2)[1] } else { '' }
    if ($value -and (Test-Path -LiteralPath $value -PathType Leaf)) {
      $found += [pscustomobject]@{ Operator=$app.Name; Status='kept existing'; Path=$value }
    } else {
      $missing += $app.Name
    }
  }
}

Write-Host "`n=== FREEOS PRODUCTION OPERATORS ===" -ForegroundColor Cyan
$found | Format-Table -AutoSize
if ($missing.Count) {
  Write-Host "`nNot auto-detected: $($missing -join ', ')" -ForegroundColor Yellow
  Write-Host "Set the matching FREEOS_OPERATOR_*_EXE value manually in E:\FREEOS\.env if installed elsewhere."
}
Write-Host "`nComputer control: $EnableComputerControl"
Write-Host "Screen capture:   $EnableScreenCapture"
Write-Host "Hard blocks for credentials, destructive system actions, live money movement, purchases, external sending, and production deployment remain unchanged." -ForegroundColor DarkGray
Write-Host "Restart FREEOS after this script so the new environment is loaded." -ForegroundColor Green
