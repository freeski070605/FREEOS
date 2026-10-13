$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"
$text = [System.IO.File]::ReadAllText($premierePath)

if ($text.Contains('FREEOS restore video start')) {
    Write-Host "Premiere assembly timeline-start restore already upgraded." -ForegroundColor DarkGray
    exit 0
}

$videoOld = @'
    let videoOutSet = false;
    project.lockedAccess(() => {
      videoOutSet = project.executeTransaction(compound => {
        compound.addAction(videoItem.createSetOutPointAction(tick(sourceOut)));
      }, `FREEOS set video out ${segmentIndex + 1}`);
    });
    if (!videoOutSet) throw new Error(`Premiere declined video out-point for segment ${segmentIndex}.`);
'@

$videoNew = @'
    let videoOutSet = false;
    project.lockedAccess(() => {
      videoOutSet = project.executeTransaction(compound => {
        compound.addAction(videoItem.createSetOutPointAction(tick(sourceOut)));
      }, `FREEOS set video out ${segmentIndex + 1}`);
    });
    if (!videoOutSet) throw new Error(`Premiere declined video out-point for segment ${segmentIndex}.`);

    let videoStartSet = false;
    project.lockedAccess(() => {
      videoStartSet = project.executeTransaction(compound => {
        compound.addAction(videoItem.createSetStartAction(tick(decision.start)));
      }, `FREEOS restore video start ${segmentIndex + 1}`);
    });
    if (!videoStartSet) throw new Error(`Premiere declined video timeline-start restore for segment ${segmentIndex}.`);
'@

if (-not $text.Contains($videoOld)) {
    throw "Expected sequential video out-point fragment was not found. Refusing blind patch."
}
$text = $text.Replace($videoOld, $videoNew)

$audioOld = @'
        let audioOutSet = false;
        project.lockedAccess(() => {
          audioOutSet = project.executeTransaction(compound => {
            compound.addAction(audioItem.createSetOutPointAction(tick(sourceOut)));
          }, `FREEOS set muted audio out ${segmentIndex + 1}`);
        });
        if (!audioOutSet) throw new Error(`Premiere declined audio out-point for segment ${segmentIndex}.`);
'@

$audioNew = @'
        let audioOutSet = false;
        project.lockedAccess(() => {
          audioOutSet = project.executeTransaction(compound => {
            compound.addAction(audioItem.createSetOutPointAction(tick(sourceOut)));
          }, `FREEOS set muted audio out ${segmentIndex + 1}`);
        });
        if (!audioOutSet) throw new Error(`Premiere declined audio out-point for segment ${segmentIndex}.`);

        let audioStartSet = false;
        project.lockedAccess(() => {
          audioStartSet = project.executeTransaction(compound => {
            compound.addAction(audioItem.createSetStartAction(tick(decision.start)));
          }, `FREEOS restore muted audio start ${segmentIndex + 1}`);
        });
        if (!audioStartSet) throw new Error(`Premiere declined audio timeline-start restore for segment ${segmentIndex}.`);
'@

if (-not $text.Contains($audioOld)) {
    throw "Expected sequential audio out-point fragment was not found. Refusing blind patch."
}
$text = $text.Replace($audioOld, $audioNew)

[System.IO.File]::WriteAllText($premierePath, $text, [System.Text.UTF8Encoding]::new($false))

Write-Host "Premiere assembly upgraded to restore requested timeline starts after source trims." -ForegroundColor Green
Write-Host "Reload the Premiere UXP plugin before the next clean assembly run." -ForegroundColor Cyan
