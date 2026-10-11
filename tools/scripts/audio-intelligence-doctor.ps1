$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$pkg = Join-Path $repo "packages/media-intelligence"
$python = Join-Path $pkg ".venv/Scripts/python.exe"
$script = Join-Path $pkg "python/audio_analyze.py"

$ok = $true

Write-Host "[FREEOS Audio Doctor]"

if (Test-Path $python) {
  try {
    & $python $script --doctor
  } catch {
    Write-Error "Python audio backend failed: $($_.Exception.Message)"
    $ok = $false
  }
} else {
  Write-Warning "Python backend missing: $python"
  Write-Host "Run: npm run audio:setup"
  $ok = $false
}

foreach ($tool in @("ffmpeg", "ffprobe")) {
  $cmd = Get-Command $tool -ErrorAction SilentlyContinue
  if ($cmd) {
    Write-Host "[$tool] $($cmd.Source)"
  } else {
    Write-Warning "$tool not found on PATH. FREEOS may still work if the matching FREEOS_* env variable is configured."
    $ok = $false
  }
}

if ($ok) {
  Write-Host "[FREEOS Audio Doctor] healthy"
  exit 0
}

Write-Host "[FREEOS Audio Doctor] incomplete"
exit 1
