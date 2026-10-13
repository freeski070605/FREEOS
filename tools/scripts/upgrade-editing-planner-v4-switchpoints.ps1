$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

function Replace-Between([string]$text, [string]$startMarker, [string]$endMarker, [string]$replacement) {
  $start = $text.IndexOf($startMarker)
  if ($start -lt 0) { throw "Could not find start marker: $startMarker" }
  $end = $text.IndexOf($endMarker, $start)
  if ($end -lt 0) { throw "Could not find end marker: $endMarker" }
  return $text.Substring(0, $start) + $replacement + $text.Substring($end)
}

# Replace any existing static/dynamic section schema block(s) with one switchpoint schema.
$schemaStartCandidates = @(
  $content.IndexOf('const sectionPlanSchema:'),
  $content.IndexOf('function buildSectionPlanSchema(')
) | Where-Object { $_ -ge 0 }
if (-not $schemaStartCandidates) { throw 'Could not find section plan schema block.' }
$schemaStart = ($schemaStartCandidates | Measure-Object -Minimum).Minimum
$asObjectPos = $content.IndexOf('function asObject', $schemaStart)
if ($asObjectPos -lt 0) { throw 'Could not find function asObject after schema block.' }

$newSchema = @'
function buildSectionPlanSchema(sectionStart: number, sectionEnd: number, videos: JsonObject[]): JsonObject {
  const step = 0.5;
  const variants = videos.flatMap((video) => {
    const id = String(video.id);
    const availableStart = Math.max(sectionStart, number(video.timelineAvailableStart, sectionStart));
    const availableEnd = Math.min(sectionEnd, number(video.timelineAvailableEnd, sectionEnd));
    if (availableEnd <= availableStart) return [];

    const legalTimes: number[] = [];
    for (let t = sectionStart; t < sectionEnd; t += step) {
      const rounded = Number(t.toFixed(3));
      if (rounded + 0.001 >= availableStart && rounded < availableEnd - 0.001) legalTimes.push(rounded);
    }
    const exactStart = Number(availableStart.toFixed(3));
    if (exactStart < availableEnd && !legalTimes.includes(exactStart)) legalTimes.push(exactStart);
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

  if (!variants.length) throw new Error(`No video sources are available for section ${sectionStart}-${sectionEnd}.`);

  return {
    type: "object",
    additionalProperties: false,
    required: ["switches", "cautions"],
    properties: {
      switches: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { oneOf: variants },
      },
      cautions: { type: "array", maxItems: 10, items: { type: "string", maxLength: 220 } },
    },
  };
}

'@
$content = $content.Substring(0, $schemaStart) + $newSchema + $content.Substring($asObjectPos)

# Replace parser + interval validator. Switchpoints cannot overlap by construction.
$newParseValidate = @'
function parseSectionPlan(text: string): { switches: unknown[]; cautions: string[] } {
  const parsed = asObject(JSON.parse(text), "section plan");
  return {
    switches: Array.isArray(parsed.switches) ? parsed.switches : [],
    cautions: Array.isArray(parsed.cautions) ? parsed.cautions.filter((v): v is string => typeof v === "string") : [],
  };
}

function validateSectionSwitches(raw: unknown[], allowedClipIds: Set<string>, sectionStart: number, sectionEnd: number, videos: JsonObject[]): EditingDecision[] {
  if (!raw.length) throw new Error(`FREEOS returned no switches for section ${sectionStart}-${sectionEnd}.`);

  const switches = raw.map((item, index) => {
    const s = asObject(item, `section switch ${index}`);
    const at = number(s.at, NaN);
    const clipId = typeof s.clipId === "string" ? s.clipId : "";
    const action = s.action;
    if (!Number.isFinite(at) || at < sectionStart - 0.01 || at >= sectionEnd) throw new Error(`Section switch ${index} has invalid timing.`);
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
  if (Math.abs(unique[0].at - sectionStart) > 0.01) throw new Error(`Section must begin with a switch at ${sectionStart}.`);

  return unique.map((item, index): EditingDecision => {
    const end = index + 1 < unique.length ? unique[index + 1].at : sectionEnd;
    if (end <= item.at) throw new Error(`Section switch ${index} does not advance the timeline.`);
    const video = videos.find((v) => String(v.id) === item.clipId);
    const availableStart = number(video?.timelineAvailableStart, 0);
    const availableEnd = number(video?.timelineAvailableEnd, 0);
    if (!video || item.at < availableStart - 0.05 || end > availableEnd + 0.05) {
      throw new Error(`Switch ${index} keeps '${item.clipId}' on screen outside source availability (${item.at}-${end} vs ${availableStart}-${availableEnd}).`);
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

# Replace clip-grouped evidence with timeline-first evidence so the model compares cameras at each moment.
$newEvidence = @'
function sectionEvidence(audio: JsonObject, videos: JsonObject[], start: number, end: number) {
  const audioWindows = Array.isArray(audio.windows) ? audio.windows as JsonObject[] : [];
  const availability = videos.map((video) => ({
    id: video.id,
    start: video.timelineAvailableStart,
    end: video.timelineAvailableEnd,
  })).filter((video) => number(video.end, 0) > start && number(video.start, 0) < end);

  const moments: JsonObject[] = [];
  for (let momentStart = start; momentStart < end; momentStart += 4) {
    const momentEnd = Math.min(end, momentStart + 4);
    const audioWindow = audioWindows.find((w) => number(w.end, 0) > momentStart && number(w.start, 0) < momentEnd);
    const candidates = videos.flatMap((video) => {
      if (number(video.timelineAvailableEnd, 0) <= momentStart || number(video.timelineAvailableStart, 0) >= momentEnd) return [];
      const windows = Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
      const w = windows.find((item) => number(item.timelineEnd, 0) > momentStart && number(item.timelineStart, 0) < momentEnd);
      if (!w) return [];
      return [{
        id: video.id,
        sharpness: w.sharpness,
        brightness: w.brightness,
        motion: w.motion,
        facePresence: w.facePresence,
        multiFacePresence: w.multiFacePresence,
        primaryFaceArea: w.primaryFaceArea,
        sceneChangeMax: w.sceneChangeMax,
        underexposedFraction: w.underexposedFraction,
        overexposedFraction: w.overexposedFraction,
      }];
    });
    moments.push({
      start: Number(momentStart.toFixed(3)),
      end: Number(momentEnd.toFixed(3)),
      audio: audioWindow ? {
        energyMean: audioWindow.energyMean,
        transientCount: audioWindow.transientCount,
        strongestTransient: audioWindow.strongestTransient,
        beatCount: audioWindow.beatCount,
      } : null,
      candidates,
    });
  }

  return { start, end, tempo: audio.tempo, loudness: audio.loudness, availability, moments };
}

'@
$content = Replace-Between $content 'function sectionEvidence' 'async function generateJson' $newEvidence

# Convert section planning to switchpoints and dynamic schema.
$content = $content.Replace('const availability = evidence.clips.map((clip) => ({ id: clip.id, start: clip.availableStart, end: clip.availableEnd }));', 'const availability = evidence.availability;')
$content = $content.Replace('schema: sectionPlanSchema,', 'schema: buildSectionPlanSchema(sectionStart, sectionEnd, videos),')
$content = $content.Replace('let parsedSection: { decisions: unknown[]; cautions: string[] };', 'let parsedSection: { switches: unknown[]; cautions: string[] };')
$content = $content.Replace('validateSectionDecisions(parsedSection.decisions, allowedClipIds, sectionStart, sectionEnd, videos)', 'validateSectionSwitches(parsedSection.switches, allowedClipIds, sectionStart, sectionEnd, videos)')
$content = $content.Replace('Make the actual creative edit decisions for ONLY timeline ${sectionStart.toFixed(3)} to ${sectionEnd.toFixed(3)} seconds. Use absolute timeline seconds.', 'Create ONE chronological edit for ONLY timeline ${sectionStart.toFixed(3)} to ${sectionEnd.toFixed(3)} seconds using switchpoints. The first switch MUST be exactly ${sectionStart.toFixed(3)}. Each switch means keep that clip on screen until the next switch. Do not output overlapping candidate alternatives. Use absolute timeline seconds.')
$content = $content.Replace('Create a fresh section edit plan for ${sectionStart.toFixed(3)}-${sectionEnd.toFixed(3)} seconds.', 'Create a fresh chronological switchpoint edit for ${sectionStart.toFixed(3)}-${sectionEnd.toFixed(3)} seconds. The first switch MUST be exactly ${sectionStart.toFixed(3)} and every chosen clip must remain available until the next switch.')
$content = $content.Replace('version: "freeos-creative-planner-v3-structured"', 'version: "freeos-creative-planner-v4-switchpoints"')
$content = $content.Replace('plannerMode: "academy-guided-staged-structured"', 'plannerMode: "academy-guided-staged-switchpoints"')

# Guard against a partial upgrade.
$required = @(
  'function buildSectionPlanSchema',
  'function validateSectionSwitches',
  'switches: Array.isArray(parsed.switches)',
  'schema: buildSectionPlanSchema(sectionStart, sectionEnd, videos)',
  'freeos-creative-planner-v4-switchpoints'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "Upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v4 switchpoints with timeline-first evidence.' -ForegroundColor Green
