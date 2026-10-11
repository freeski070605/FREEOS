$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$plugin = Join-Path $repo 'adobe\premiere-uxp'
if (-not (Test-Path -LiteralPath (Join-Path $plugin 'manifest.json'))) { throw 'Premiere plugin manifest missing.' }
Write-Host "Open Adobe UXP Developer Tool, add this plugin folder, and load it in Premiere: $plugin"
Write-Host 'Enable Premiere Plugins > Developer Mode first. Open the FREEOS Bridge panel and enter FREEOS_ADOBE_BRIDGE_TOKEN from the AIO .env.'
