$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"

$text = [System.IO.File]::ReadAllText($premierePath)

$old = '"sequence.applyAssembly": applyAssembly,'
$new = '"sequence.applyassembly": applyAssembly,'

if ($text.Contains($new)) {
    Write-Host "Premiere action name already normalized." -ForegroundColor DarkGray
    exit 0
}

if (-not $text.Contains($old)) {
    throw "Expected sequence.applyAssembly action entry was not found. Refusing blind patch."
}

$updated = $text.Replace($old, $new)
[System.IO.File]::WriteAllText($premierePath, $updated, [System.Text.UTF8Encoding]::new($false))

Write-Host "Premiere action renamed to sequence.applyassembly." -ForegroundColor Green
Write-Host "Reload the Premiere UXP plugin, reconnect, then use action=sequence.applyassembly for jobs." -ForegroundColor Cyan
