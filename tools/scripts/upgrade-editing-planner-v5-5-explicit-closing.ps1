$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.5-explicit-closing')) {
  Write-Host '[FREEOS] Editing Planner v5.5 explicit closing is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.4-nondegenerate-review')) {
  throw 'Planner v5.4 nondegenerate review must be installed before applying v5.5.'
}

# Replace only the whole-assembly schema. Section planning remains unchanged.
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

  # A closing variant may only use a clip that can remain on screen through the assembly end.
  const closingVariants = videos.flatMap((video) => {
    const id = String(video.id);
    const availableStart = Math.max(0, number(video.timelineAvailableStart, 0));
    const availableEnd = number(video.timelineAvailableEnd, 0);
    if (availableEnd < end - 0.05) return [];
    const legalTimes: number[] = [];
    for (let t = 0.5; t < end; t += step) {
      const rounded = Number(t.toFixed(3));
      if (rounded + 0.001 >= availableStart) legalTimes.push(rounded);
    }
    const exactStart = Number(availableStart.toFixed(3));
    if (exactStart > 0.001 && exactStart < end && !legalTimes.includes(exactStart)) legalTimes.push(exactStart);
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
  if (!closingVariants.length) throw new Error('No video source can cover the assembly ending.');

  return {
    type: "object",
    additionalProperties: false,
    required: ["opening", "switches", "closing"],
    properties: {
      opening: { oneOf: openingVariants },
      switches: {
        type: "array",
        maxItems: 31,
        items: { oneOf: switchVariants },
      },
      closing: { oneOf: closingVariants },
    },
  };
}

'@
# PowerShell here-string contains one comment written with '#'; convert that one TS-invalid line to //.
$newSchema = $newSchema.Replace('  # A closing variant may only use a clip that can remain on screen through the assembly end.', '  // A closing variant may only use a clip that can remain on screen through the assembly end.')
$content = $content.Substring(0, $start) + $newSchema + $content.Substring($end)

# Add a dedicated assembly parser/validator. Section parser stays untouched.
$parseMarker = 'function parseSectionPlan('
$parsePos = $content.IndexOf($parseMarker)
if ($parsePos -lt 0) { throw 'Could not find section parser.' }
if (-not $content.Contains('function parseAssemblyReview(')) {
  $assemblyHelpers = @'
function parseAssemblyReview(text: string): { opening: unknown; switches: unknown[]; closing: unknown } {
  const parsed = asObject(JSON.parse(text), "assembly review");
  return {
    opening: parsed.opening,
    switches: Array.isArray(parsed.switches) ? parsed.switches : [],
    closing: parsed.closing,
  };
}

function validateAssemblyReview(raw: { opening: unknown; switches: unknown[]; closing: unknown }, allowedClipIds: Set<string>, end: number, videos: JsonObject[]): EditingDecision[] {
  const closing = asObject(raw.closing, "assembly closing");
  const closingAt = number(closing.at, NaN);
  const closingClipId = typeof closing.clipId === "string" ? closing.clipId : "";
  const closingAction = closing.action;
  if (!Number.isFinite(closingAt) || closingAt <= 0.001 || closingAt >= end) throw new Error('Assembly closing has invalid timing.');
  if (!allowedClipIds.has(closingClipId)) throw new Error(`Assembly closing references unknown clip '${closingClipId}'.`);
  if (closingAction !== "cut" && closingAction !== "hold" && closingAction !== "punch-in") throw new Error('Assembly closing has invalid action.');
  const closingVideo = videos.find((video) => String(video.id) === closingClipId);
  const closingAvailableStart = number(closingVideo?.timelineAvailableStart, 0);
  const closingAvailableEnd = number(closingVideo?.timelineAvailableEnd, 0);
  if (!closingVideo || closingAt < closingAvailableStart - 0.05 || closingAvailableEnd < end - 0.05) {
    throw new Error(`Assembly closing clip '${closingClipId}' cannot cover ${closingAt}-${end} (${closingAvailableStart}-${closingAvailableEnd}).`);
  }

  const earlier = raw.switches.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    return number((item as JsonObject).at, NaN) < closingAt - 0.001;
  });
  if (earlier.length !== raw.switches.length) throw new Error('Assembly review contains a regular switch at or after the required closing switch.');

  const allSwitches = [...earlier, {
    at: closingAt,
    clipId: closingClipId,
    action: closingAction,
    confidence: number(closing.confidence, 0.5),
    rationale: "",
  }];
  return validateSectionSwitches(raw.opening, allSwitches, allowedClipIds, 0, end, videos);
}

'@
  $content = $content.Substring(0, $parsePos) + $assemblyHelpers + $content.Substring($parsePos)
}

# Global review and repair now use the explicit-closing parser/validator.
$content = $content.Replace('const parsedAssembly = parseSectionPlan(assemblyText);', 'const parsedAssembly = parseAssemblyReview(assemblyText);')
$content = $content.Replace('reviewedDecisions = validateSectionSwitches(parsedAssembly.opening, parsedAssembly.switches, allowedClipIds, 0, availableEnd, videos);', 'reviewedDecisions = validateAssemblyReview(parsedAssembly, allowedClipIds, availableEnd, videos);')
$content = $content.Replace('const parsedRepair = parseSectionPlan(repairText);', 'const parsedRepair = parseAssemblyReview(repairText);')
$content = $content.Replace('reviewedDecisions = validateSectionSwitches(parsedRepair.opening, parsedRepair.switches, allowedClipIds, 0, availableEnd, videos);', 'reviewedDecisions = validateAssemblyReview(parsedRepair, allowedClipIds, availableEnd, videos);')

# Tell both finishing prompts the output contract now has an explicit closing switch.
$content = $content.Replace('Output a complete chronological opening plus later switchpoints.', 'Output a complete chronological opening, later switchpoints, and a required closing switch whose clip remains available through the assembly end.')
$content = $content.Replace('Return a complete chronological opening plus later switchpoints for 0 to ${availableEnd.toFixed(3)} seconds.', 'Return a complete chronological opening, later switchpoints, and a required closing switch for 0 to ${availableEnd.toFixed(3)} seconds. The closing clip must remain source-available through the assembly end.')

$content = $content.Replace('version: "freeos-creative-planner-v5.4-nondegenerate-review"', 'version: "freeos-creative-planner-v5.5-explicit-closing"')

$required = @(
  'required: ["opening", "switches", "closing"]',
  'function parseAssemblyReview(',
  'function validateAssemblyReview(',
  'validateAssemblyReview(parsedAssembly',
  'validateAssemblyReview(parsedRepair',
  'required closing switch',
  'freeos-creative-planner-v5.5-explicit-closing'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.5 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.5 explicit source-safe closing.' -ForegroundColor Green
