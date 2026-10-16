$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"
$text = [System.IO.File]::ReadAllText($premierePath)

$videoOld = @'
    let videoStartSet = false;
    project.lockedAccess(() => {
      videoStartSet = project.executeTransaction(compound => {
        compound.addAction(videoItem.createSetStartAction(tick(decision.start)));
      }, `FREEOS restore video start ${segmentIndex + 1}`);
    });
    if (!videoStartSet) throw new Error(`Premiere declined video timeline-start restore for segment ${segmentIndex}.`);
'@

$videoNew = @'
    const currentVideoStart = (await videoItem.getStartTime()).seconds;
    const videoMoveDelta = decision.start - currentVideoStart;
    if (Math.abs(videoMoveDelta) > 0.0005) {
      let videoMoved = false;
      project.lockedAccess(() => {
        videoMoved = project.executeTransaction(compound => {
          compound.addAction(videoItem.createMoveAction(tick(videoMoveDelta)));
        }, `FREEOS move video segment ${segmentIndex + 1}`);
      });
      if (!videoMoved) throw new Error(`Premiere declined video timeline move for segment ${segmentIndex}.`);
    }
'@

$audioOld = @'
        let audioStartSet = false;
        project.lockedAccess(() => {
          audioStartSet = project.executeTransaction(compound => {
            compound.addAction(audioItem.createSetStartAction(tick(decision.start)));
          }, `FREEOS restore muted audio start ${segmentIndex + 1}`);
        });
        if (!audioStartSet) throw new Error(`Premiere declined audio timeline-start restore for segment ${segmentIndex}.`);
'@

$audioNew = @'
        const currentAudioStart = (await audioItem.getStartTime()).seconds;
        const audioMoveDelta = decision.start - currentAudioStart;
        if (Math.abs(audioMoveDelta) > 0.0005) {
          let audioMoved = false;
          project.lockedAccess(() => {
            audioMoved = project.executeTransaction(compound => {
              compound.addAction(audioItem.createMoveAction(tick(audioMoveDelta)));
            }, `FREEOS move muted audio segment ${segmentIndex + 1}`);
          });
          if (!audioMoved) throw new Error(`Premiere declined audio timeline move for segment ${segmentIndex}.`);
        }
'@

if ($text.Contains('FREEOS move video segment') -and $text.Contains('FREEOS move muted audio segment')) {
    Write-Host "Premiere assembly move-action patch already applied." -ForegroundColor DarkGray
    exit 0
}

if (-not $text.Contains($videoOld)) {
    throw "Expected exact local video createSetStartAction block was not found. Refusing blind patch."
}
if (-not $text.Contains($audioOld)) {
    throw "Expected exact local audio createSetStartAction block was not found. Refusing blind patch."
}

$updated = $text.Replace($videoOld, $videoNew).Replace($audioOld, $audioNew)
[System.IO.File]::WriteAllText($premierePath, $updated, [System.Text.UTF8Encoding]::new($false))

Write-Host "Premiere assembly upgraded for this AIO source shape: createSetStartAction -> createMoveAction(delta)." -ForegroundColor Green
Write-Host "Reload the Premiere UXP plugin before the next clean assembly run." -ForegroundColor Cyan
