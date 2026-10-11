$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $repo '.env'
Write-Host "FREEOS Adobe configuration: $envPath"
if (-not (Test-Path -LiteralPath $envPath)) { Write-Host 'Missing .env'; exit 1 }
$pairs = @{}
Get-Content -LiteralPath $envPath | ForEach-Object { if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $pairs[$matches[1]] = $matches[2] } }
foreach ($name in @('FREEOS_ADOBE_ENABLED','FREEOS_ADOBE_WORKER_MODE','FREEOS_ADOBE_WORKER_HOST','FREEOS_ADOBE_WORKER_PORT','FREEOS_ADOBE_WORKER_URL','FREEOS_PREMIERE_PATH','FREEOS_AFTER_EFFECTS_PATH','FREEOS_MEDIA_ENCODER_PATH','FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS','FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS')) { Write-Host "$name=$($pairs[$name])" }
foreach ($name in @('FREEOS_ADOBE_WORKER_TOKEN','FREEOS_ADOBE_BRIDGE_TOKEN')) { Write-Host "$name configured=$([bool]$pairs[$name])" }
foreach ($name in @('FREEOS_PREMIERE_PATH','FREEOS_AFTER_EFFECTS_PATH','FREEOS_MEDIA_ENCODER_PATH')) { if ($pairs[$name]) { Write-Host "$name exists=$(Test-Path -LiteralPath $pairs[$name])" } }
