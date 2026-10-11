param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$pkg = Join-Path $repo "packages/media-intelligence"
$venv = Join-Path $pkg ".venv"
$venvPython = Join-Path $venv "Scripts/python.exe"

Write-Host "[FREEOS Media] repo: $repo"

if (-not (Test-Path $venvPython)) {
  Write-Host "[FREEOS Media] creating Python virtual environment..."
  & $Python -m venv $venv
}

if (-not (Test-Path $venvPython)) {
  throw "Media intelligence virtual environment was not created: $venvPython"
}

Write-Host "[FREEOS Media] upgrading pip..."
& $venvPython -m pip install --upgrade pip

Write-Host "[FREEOS Media] installing CPU audio/video-analysis dependencies..."
& $venvPython -m pip install --upgrade numpy scipy librosa soundfile "opencv-python-headless==4.13.0.92"

$audioScript = Join-Path $pkg "python/audio_analyze.py"
$videoScript = Join-Path $pkg "python/video_analyze.py"
Write-Host "[FREEOS Media] running audio backend doctor..."
& $venvPython $audioScript --doctor
Write-Host "[FREEOS Media] running video backend doctor..."
& $venvPython $videoScript --doctor

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffmpeg) { Write-Warning "ffmpeg is not on PATH. Set FREEOS_FFMPEG_PATH to ffmpeg.exe or add FFmpeg to PATH." }
if (-not $ffprobe) { Write-Warning "ffprobe is not on PATH. Set FREEOS_FFPROBE_PATH to ffprobe.exe or add FFmpeg to PATH." }

Write-Host "[FREEOS Media] setup complete."
