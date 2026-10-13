$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"
$text = [System.IO.File]::ReadAllText($premierePath)

$old = @'
        compound.addAction(editor.createInsertProjectItemAction(
          source.projectItem,
          tick(decision.start),
          outputVideoIndex,
          outputAudioIndex,
          true
        ));
'@

$new = @'
        const placementAction = segmentIndex === 0
          ? editor.createInsertProjectItemAction(
              source.projectItem,
              tick(decision.start),
              outputVideoIndex,
              outputAudioIndex,
              true
            )
          : editor.createOverwriteItemAction(
              source.projectItem,
              tick(decision.start),
              outputVideoIndex,
              outputAudioIndex
            );
        compound.addAction(placementAction);
'@

if ($text.Contains('segmentIndex === 0') -and $text.Contains('createOverwriteItemAction(')) {
    Write-Host "Premiere first-insert/rest-overwrite assembly already upgraded." -ForegroundColor DarkGray
    exit 0
}

if (-not $text.Contains($old)) {
    throw "Expected createInsertProjectItemAction assembly fragment was not found. Refusing blind patch."
}

$updated = $text.Replace($old, $new)
[System.IO.File]::WriteAllText($premierePath, $updated, [System.Text.UTF8Encoding]::new($false))

Write-Host "Premiere assembly placement upgraded: first segment INSERT creates V6/A6; remaining segments OVERWRITE without ripple." -ForegroundColor Green
Write-Host "Reload the Premiere UXP plugin before the next clean assembly run." -ForegroundColor Cyan
