$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if (-not $content.Contains('freeos-creative-planner-v5-semantic')) {
  throw 'Planner v5 semantic must be installed before applying v5.1 opening-switch repair.'
}

function Replace-Between([string]$text, [string]$startMarker, [string]$endMarker, [string]$replacement) {
  $start = $text.IndexOf($startMarker)
  if ($start -lt 0) { throw "Could not find start marker: $startMarker" }
  $end = $text.IndexOf($endMarker, $start)
  if ($end -lt 0) { throw "Could not find end marker: $endMarker" }
  return $text.Substring(0, $start) + $replacement + $text.Substring($end)
}

$newSchema = @'
function buildSectionPlanSchema(sectionStart: number, sectionEnd: number, videos: JsonObject[]): JsonObject {
  const step = 0.5;

  const openingVariants = videos.flatMap((video) => {
    const id = String(video.id);
    const availableStart = number(video.timelineAvailableStart, sectionStart);
    const availableEnd = number(video.timelineAvailableEnd, sectionEnd);
    if (availableStart > sectionStart + 0.001 || availableEnd <= sectionStart + 0.001) return [];
    return [{
      type: "object",
      additionalProperties: false,
      required: ["clipId", "action", "confidence", "rationale"],
      properties: {
        clipId: { const: id },
        action: { type: "string", enum: ["cut", "hold", "punch-in"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rationale: { type: "string", maxLength: 180 },
      },
    }];
  });

  const switchVariants = videos.flatMap((video) => {
    const id = String(video.id);
    const availableStart = Math.max(sectionStart, number(video.timelineAvailableStart, sectionStart));
    const availableEnd = Math.min(sectionEnd, number(video.timelineAvailableEnd, sectionEnd));
    if (availableEnd <= availableStart) return [];

    const legalTimes: number[] = [];
    for (let t = sectionStart + step; t < sectionEnd; t += step) {
      const rounded = Number(t.toFixed(3));
      if (rounded + 0.001 >= availableStart && rounded < availableEnd - 0.001) legalTimes.push(rounded);
    }
    const exactStart = Number(availableStart.toFixed(3));
    if (exactStart > sectionStart + 0.001 && exactStart < availableEnd && !legalTimes.includes(exactStart)) legalTimes.push(exactStart);
    legalTimes.sort((a, b) => a - b);
    if (!legalTimes.length) return [];

    return [{
      type: "object",
      additionalProperties: false,
      required: ["at", "clipId", "action", "confidence", "rationale"],
      properties: {
        at: { type: "number", enum: legalTimes },
        clipId: { const: id },
        action: { type: "string", enum: ["cut", "hold", "punch-in"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rationale: { type: "string", maxLength: 180 },
      },
    }];
  });

  if (!openingVariants.length) throw new Error(`No video source is available at section start ${sectionStart}.`);

  return {
    type: "object",
    additionalProperties: false,
    required: ["opening", "switches", "cautions"],
    properties: {
      opening: { oneOf: openingVariants },
      switches: switchVariants.length ? {
        type: "array",
        maxItems: 19,
        items: { oneOf: switchVariants },
      } : { type: "array", maxItems: 0 },
      cautions: { type: "array", maxItems: 10, items: { type: "string", maxLength: 220 } },
    },
  };
}

'@
$content = Replace-Between $content 'function buildSectionPlanSchema' 'function asObject' $newSchema

$newParseValidate = @'
function parseSectionPlan(text: string): { opening: unknown; switches: unknown[]; cautions: string[] } {
  const parsed = asObject(JSON.parse(text), "section plan");
  return {
    opening: parsed.opening,
    switches: Array.isArray(parsed.switches) ? parsed.switches : [],
    cautions: Array.isArray(parsed.cautions) ? parsed.cautions.filter((v): v is string => typeof v === "string") : [],
  };
}

function validateSectionSwitches(openingRaw: unknown, raw: unknown[], allowedClipIds: Set<string>, sectionStart: number, sectionEnd: number, videos: JsonObject[]): EditingDecision[] {
  const opening = asObject(openingRaw, "section opening");
  const openingClipId = typeof opening.clipId === "string" ? opening.clipId : "";
  const openingAction = opening.action;
  if (!allowedClipIds.has(openingClipId)) throw new Error(`Section opening references unknown clip '${openingClipId}'.`);
  if (openingAction !== "cut" && openingAction !== "hold" && openingAction !== "punch-in") throw new Error('Section opening has invalid action.');

  const openingVideo = videos.find((v) => String(v.id) === openingClipId);
  if (!openingVideo || sectionStart < number(openingVideo.timelineAvailableStart, 0) - 0.01 || sectionStart >= number(openingVideo.timelineAvailableEnd, 0) - 0.01) {
    throw new Error(`Section opening clip '${openingClipId}' is unavailable at ${sectionStart}.`);
  }

  const switches = raw.map((item, index) => {
    const s = asObject(item, `section switch ${index}`);
    const at = number(s.at, NaN);
    const clipId = typeof s.clipId === "string" ? s.clipId : "";
    const action = s.action;
    if (!Number.isFinite(at) || at <= sectionStart + 0.001 || at >= sectionEnd) throw new Error(`Section switch ${index} has invalid timing.`);
    if (!allowedClipIds.has(clipId)) throw new Error(`Section switch ${index} references unknown clip '${clipId}'.`);
    if (action !== "cut" && action !== "hold" && action !== "punch-in") throw new Error(`Section switch ${index} has invalid action.`);
    return {
      at,
      clipId,
      action: action as EditingDecision["action"],
      confidence: Math.max(0, Math.min(1, number(s.confidence, 0.5))),
      rationale: typeof s.rationale === "string" ? s.rationale.slice(0, 500) : "",
    };
  }).sort((a, b) => a.at - b.at || b.confidence - a.confidence);

  const unique = switches.filter((item, index) => index === 0 || Math.abs(item.at - switches[index - 1].at) > 0.001);
  const points = [{
    at: sectionStart,
    clipId: openingClipId,
    action: openingAction as EditingDecision["action"],
    confidence: Math.max(0, Math.min(1, number(opening.confidence, 0.5))),
    rationale: typeof opening.rationale === "string" ? opening.rationale.slice(0, 500) : "",
  }, ...unique];

  return points.map((item, index): EditingDecision => {
    const end = index + 1 < points.length ? points[index + 1].at : sectionEnd;
    if (end <= item.at) throw new Error(`Section point ${index} does not advance the timeline.`);
    const video = videos.find((v) => String(v.id) === item.clipId);
    const availableStart = number(video?.timelineAvailableStart, 0);
    const availableEnd = number(video?.timelineAvailableEnd, 0);
    if (!video || item.at < availableStart - 0.05 || end > availableEnd + 0.05) {
      throw new Error(`Section point ${index} keeps '${item.clipId}' on screen outside source availability (${item.at}-${end} vs ${availableStart}-${availableEnd}).`);
    }
    return {
      start: item.at,
      end,
      clipId: item.clipId,
      action: item.action,
      confidence: item.confidence,
      rationale: item.rationale,
    };
  });
}

'@
$content = Replace-Between $content 'function parseSectionPlan' 'function sectionEvidence' $newParseValidate

$content = $content.Replace('let parsedSection: { switches: unknown[]; cautions: string[] };', 'let parsedSection: { opening: unknown; switches: unknown[]; cautions: string[] };')
$content = $content.Replace('validateSectionSwitches(parsedSection.switches, allowedClipIds, sectionStart, sectionEnd, videos)', 'validateSectionSwitches(parsedSection.opening, parsedSection.switches, allowedClipIds, sectionStart, sectionEnd, videos)')
$content = $content.Replace('The first switch MUST be exactly ${sectionStart.toFixed(3)}. Each switch means keep that clip on screen until the next switch.', 'Choose an opening clip for exactly ${sectionStart.toFixed(3)}, then add later switchpoints only when creatively motivated. The opening clip stays on screen until the first switch; each later switch stays until the next.')
$content = $content.Replace('The first switch MUST be exactly ${sectionStart.toFixed(3)} and every chosen clip must remain available until the next switch.', 'Choose a valid opening clip at exactly ${sectionStart.toFixed(3)} and only later switchpoints after that. Every chosen clip must remain available until the next switch.')
$content = $content.Replace('version: "freeos-creative-planner-v5-semantic"', 'version: "freeos-creative-planner-v5.1-semantic-opening"')
$content = $content.Replace('plannerMode: "academy-guided-staged-semantic-switchpoints"', 'plannerMode: "academy-guided-staged-semantic-opening-switchpoints"')

$required = @(
  'required: ["opening", "switches", "cautions"]',
  'opening: { oneOf: openingVariants }',
  'validateSectionSwitches(parsedSection.opening, parsedSection.switches',
  'freeos-creative-planner-v5.1-semantic-opening'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.1 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.1 semantic opening-switchpoints.' -ForegroundColor Green
