$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"

function Replace-Exact {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Old,
        [Parameter(Mandatory=$true)][string]$New,
        [Parameter(Mandatory=$true)][string]$AlreadyPresent,
        [Parameter(Mandatory=$true)][string]$Label
    )
    $text = [System.IO.File]::ReadAllText($Path)
    if ($text.Contains($AlreadyPresent)) {
        Write-Host "$Label already upgraded." -ForegroundColor DarkGray
        return
    }
    if (-not $text.Contains($Old)) {
        throw "${Label}: expected source fragment was not found. Refusing blind patch."
    }
    $updated = $text.Replace($Old, $New)
    [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
    Write-Host "$Label upgraded." -ForegroundColor Green
}

$videoOld = @'
    let videoTrimmed = false;
    project.lockedAccess(() => {
      videoTrimmed = project.executeTransaction(compound => {
        compound.addAction(videoItem.createSetInPointAction(tick(sourceIn)));
        compound.addAction(videoItem.createSetOutPointAction(tick(sourceOut)));
        compound.addAction(videoItem.createSetEndAction(tick(decision.end)));
      }, `FREEOS trim video segment ${segmentIndex + 1}`);
    });
    if (!videoTrimmed) throw new Error(`Premiere declined video trim for segment ${segmentIndex}.`);
'@

$videoNew = @'
    const currentVideoIn = (await videoItem.getInPoint()).seconds;
    if (Math.abs(currentVideoIn - sourceIn) > 0.0005) {
      let videoInSet = false;
      project.lockedAccess(() => {
        videoInSet = project.executeTransaction(compound => {
          compound.addAction(videoItem.createSetInPointAction(tick(sourceIn)));
        }, `FREEOS set video in ${segmentIndex + 1}`);
      });
      if (!videoInSet) throw new Error(`Premiere declined video in-point for segment ${segmentIndex}.`);
    }

    let videoOutSet = false;
    project.lockedAccess(() => {
      videoOutSet = project.executeTransaction(compound => {
        compound.addAction(videoItem.createSetOutPointAction(tick(sourceOut)));
      }, `FREEOS set video out ${segmentIndex + 1}`);
    });
    if (!videoOutSet) throw new Error(`Premiere declined video out-point for segment ${segmentIndex}.`);
'@

Replace-Exact -Path $premierePath -Old $videoOld -New $videoNew -AlreadyPresent 'FREEOS set video out' -Label "Premiere sequential video trim"

$audioOld = @'
        let audioTrimmed = false;
        project.lockedAccess(() => {
          audioTrimmed = project.executeTransaction(compound => {
            compound.addAction(audioItem.createSetInPointAction(tick(sourceIn)));
            compound.addAction(audioItem.createSetOutPointAction(tick(sourceOut)));
            compound.addAction(audioItem.createSetEndAction(tick(decision.end)));
          }, `FREEOS trim muted source audio ${segmentIndex + 1}`);
        });
        if (!audioTrimmed) throw new Error(`Premiere declined audio trim for segment ${segmentIndex}.`);
'@

$audioNew = @'
        const currentAudioIn = (await audioItem.getInPoint()).seconds;
        if (Math.abs(currentAudioIn - sourceIn) > 0.0005) {
          let audioInSet = false;
          project.lockedAccess(() => {
            audioInSet = project.executeTransaction(compound => {
              compound.addAction(audioItem.createSetInPointAction(tick(sourceIn)));
            }, `FREEOS set muted audio in ${segmentIndex + 1}`);
          });
          if (!audioInSet) throw new Error(`Premiere declined audio in-point for segment ${segmentIndex}.`);
        }

        let audioOutSet = false;
        project.lockedAccess(() => {
          audioOutSet = project.executeTransaction(compound => {
            compound.addAction(audioItem.createSetOutPointAction(tick(sourceOut)));
          }, `FREEOS set muted audio out ${segmentIndex + 1}`);
        });
        if (!audioOutSet) throw new Error(`Premiere declined audio out-point for segment ${segmentIndex}.`);
'@

Replace-Exact -Path $premierePath -Old $audioOld -New $audioNew -AlreadyPresent 'FREEOS set muted audio out' -Label "Premiere sequential audio trim"

Write-Host "`nPremiere assembly trim upgrade complete." -ForegroundColor Cyan
Write-Host "Reload the Premiere UXP plugin after applying this patch." -ForegroundColor Cyan
