$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target = Join-Path $repoRoot 'adobe\premiere-uxp\index.js'

if (-not (Test-Path $target)) {
    throw "Premiere UXP bridge not found: $target"
}

$text = [System.IO.File]::ReadAllText($target)

if ($text -match '"sequence\.exportreview"\s*:') {
    Write-Host 'sequence.exportreview is already registered; no changes needed.' -ForegroundColor Yellow
    exit 0
}

$functionAnchor = 'async function sequenceMarkers()'
if (-not $text.Contains($functionAnchor)) {
    throw 'Expected sequenceMarkers function anchor was not found. Refusing blind patch.'
}

$exportFunction = @'
async function exportReview(command) {
  const project = await activeProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active sequence.");

  const activeId = await sequenceId(sequence);
  if (command.args.sequenceId && command.args.sequenceId !== activeId) {
    throw new Error("Refusing review export: active sequence does not match sequenceId.");
  }
  if (!/^BLAKEO_FREEOS_(PASS_\d{2}|FINAL)$/.test(sequence.name)) {
    throw new Error("Refusing review export outside a FREEOS Blakeo working sequence.");
  }

  const outputFile = command.args.outputPath;
  const presetFile = command.args.presetPath || "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Settings\\IngestPresets\\Transcode\\Match Source - H.264 High Bitrate.epr";

  if (typeof outputFile !== "string" || !/^D:\\Freeski\\adobe\\FREEOS_REVIEW\\[^\\/:*?\"<>|]+\.mp4$/i.test(outputFile)) {
    throw new Error("outputPath must be an .mp4 inside D:\\Freeski\\adobe\\FREEOS_REVIEW.");
  }
  if (typeof presetFile !== "string" || !/\.epr$/i.test(presetFile)) {
    throw new Error("presetPath must point to an .epr preset.");
  }

  const manager = premiere.EncoderManager.getManager();
  const extension = await premiere.EncoderManager.getExportFileExtension(sequence, presetFile);
  if (String(extension || "").toLowerCase().replace(/^\./, "") !== "mp4") {
    throw new Error(`Selected preset exports .${extension || "unknown"}, expected .mp4.`);
  }

  const exported = await manager.exportSequence(
    sequence,
    premiere.Constants.ExportType.IMMEDIATELY,
    outputFile,
    presetFile,
    true
  );
  if (!exported) throw new Error("Premiere declined the review export.");

  return {
    exported: true,
    sequenceId: activeId,
    sequenceName: sequence.name,
    outputPath: outputFile,
    presetPath: presetFile,
    extension: "mp4"
  };
}
'@

$text = $text.Replace($functionAnchor, ($exportFunction + "`r`n" + $functionAnchor))

$actionPattern = '(?m)^(\s*)"sequence\.apply(?:Assembly|assembly)"\s*:\s*applyAssembly,\s*$'
$match = [regex]::Match($text, $actionPattern)
if (-not $match.Success) {
    throw 'Expected sequence.applyassembly action registration was not found. Refusing blind patch.'
}

$indent = $match.Groups[1].Value
$replacement = $match.Value + "`r`n" + $indent + '"sequence.exportreview": exportReview,'
$text = [regex]::Replace($text, $actionPattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement }, 1)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $text, $utf8NoBom)

Write-Host 'Premiere review export capability added: sequence.exportreview.' -ForegroundColor Green
Write-Host 'Reload the Premiere UXP plugin, then run npm run adobe:status to verify it is advertised.' -ForegroundColor Cyan
