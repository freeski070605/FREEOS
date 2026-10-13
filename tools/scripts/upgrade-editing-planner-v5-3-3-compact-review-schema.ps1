$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.3.3-compact-review')) {
  Write-Host '[FREEOS] Editing Planner v5.3.3 compact review is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.3.2-review-retry')) {
  throw 'Planner v5.3.2 review retry must be installed before applying v5.3.3 compact review.'
}

$start = $content.IndexOf('function buildAssemblyReviewSchema(')
$end = $content.IndexOf('function buildSectionPlanSchema(', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Could not locate assembly review schema.' }

$newSchema = @'
function buildAssemblyReviewSchema(end: number, videos: JsonObject[]): JsonObject {
  const step = 0.5;
  const openingVariants = videos.flatMap((video) => {
    const id = String(video.id);
    const availableStart = number(video.timelineAvailableStart, 0);
    const availableEnd = number(video.timelineAvailableEnd, end);
    if (availableStart > 0.001 || availableEnd <= 0.001) return [];
    return [{
      type: "object",
      additionalProperties: false,
      required: ["clipId", "action", "confidence"],
      properties: {
        clipId: { const: id },
        action: { type: "string", enum: ["cut", "hold", "punch-in"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    }];
  });

  const switchVariants = videos.flatMap((video) => {
    const id = String(video.id);
    const availableStart = Math.max(0, number(video.timelineAvailableStart, 0));
    const availableEnd = Math.min(end, number(video.timelineAvailableEnd, end));
    if (availableEnd <= availableStart) return [];
    const legalTimes: number[] = [];
    for (let t = 0.5; t < end; t += step) {
      const rounded = Number(t.toFixed(3));
      if (rounded + 0.001 >= availableStart && rounded < availableEnd - 0.001) legalTimes.push(rounded);
    }
    const exactStart = Number(availableStart.toFixed(3));
    if (exactStart > 0.001 && exactStart < availableEnd && !legalTimes.includes(exactStart)) legalTimes.push(exactStart);
    legalTimes.sort((a, b) => a - b);
    if (!legalTimes.length) return [];
    return [{
      type: "object",
      additionalProperties: false,
      required: ["at", "clipId", "action", "confidence"],
      properties: {
        at: { type: "number", enum: legalTimes },
        clipId: { const: id },
        action: { type: "string", enum: ["cut", "hold", "punch-in"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    }];
  });

  if (!openingVariants.length) throw new Error('No video source is available at timeline start.');
  return {
    type: "object",
    additionalProperties: false,
    required: ["opening", "switches"],
    properties: {
      opening: { oneOf: openingVariants },
      switches: {
        type: "array",
        maxItems: 32,
        items: { oneOf: switchVariants },
      },
    },
  };
}

'@
$content = $content.Substring(0, $start) + $newSchema + $content.Substring($end)

$content = $content.Replace('numPredict: 2600,', 'numPredict: 3600,')
$content = $content.Replace('version: "freeos-creative-planner-v5.3.2-review-retry"', 'version: "freeos-creative-planner-v5.3.3-compact-review"')

$required = @(
  'required: ["clipId", "action", "confidence"]',
  'required: ["at", "clipId", "action", "confidence"]',
  'maxItems: 32',
  'numPredict: 3600,',
  'freeos-creative-planner-v5.3.3-compact-review'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.3.3 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.3.3 compact global review.' -ForegroundColor Green
