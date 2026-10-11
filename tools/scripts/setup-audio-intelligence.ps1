param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$pkg = Join-Path $repo "packages/media-intelligence"
$venv = Join-Path $pkg ".venv"
$venvPython = Join-Path $venv "Scripts/python.exe"

Write-Host "[FREEOS Audio] repo: $repo"

if (-not (Test-Path $venvPython)) {
  Write-Host "[FREEOS Audio] creating Python virtual environment..."
  & $Python -m venv $venv
}

if (-not (Test-Path $venvPython)) {
  throw "Audio intelligence virtual environment was not created: $venvPython"
}

Write-Host "[FREEOS Audio] upgrading pip..."
& $venvPython -m pip install --upgrade pip

Write-Host "[FREEOS Audio] installing CPU audio-analysis dependencies..."
& $venvPython -m pip install --upgrade numpy scipy librosa soundfile

$script = Join-Path $pkg "python/audio_analyze.py"
Write-Host "[FREEOS Audio] running backend doctor..."
& $venvPython $script --doctor

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffmpeg) { Write-Warning "ffmpeg is not on PATH. Set FREEOS_FFMPEG_PATH to ffmpeg.exe or add FFmpeg to PATH." }
if (-not $ffprobe) { Write-Warning "ffprobe is not on PATH. Set FREEOS_FFPROBE_PATH to ffprobe.exe or add FFmpeg to PATH." }

Write-Host "[FREEOS Audio] setup complete."
