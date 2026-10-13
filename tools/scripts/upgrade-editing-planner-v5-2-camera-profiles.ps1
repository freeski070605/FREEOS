$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.2-camera-profiles')) {
  Write-Host '[FREEOS] Editing Planner v5.2 camera profiles is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.1-semantic-opening')) {
  throw 'Planner v5.1 semantic opening must be installed before applying v5.2 camera profiles.'
}

function Replace-Between([string]$text, [string]$startMarker, [string]$endMarker, [string]$replacement) {
  $start = $text.IndexOf($startMarker)
  if ($start -lt 0) { throw "Could not find start marker: $startMarker" }
  $end = $text.IndexOf($endMarker, $start)
  if ($end -lt 0) { throw "Could not find end marker: $endMarker" }
  return $text.Substring(0, $start) + $replacement + $text.Substring($end)
}

# Extend the planner evidence contract so the caller can verify the camera interpretation pass ran.
$evidenceMarker = '    plannerMode?: string;'
if (-not $content.Contains($evidenceMarker)) { throw 'Could not find EditingPlan evidence contract.' }
if (-not $content.Contains('cameraProfileCount?: number;')) {
  $content = $content.Replace($evidenceMarker, $evidenceMarker + "`r`n    cameraProfileCount?: number;")
}

# Add a strongly typed camera-profile pass. Clip ids are schema-enforced and validated against the real input ids.
$creativeInterfaceMarker = @'
interface CreativeBrief {
  creativeSummary: string;
  principles: string[];
  cautions: string[];
}
'@
if (-not $content.Contains($creativeInterfaceMarker)) { throw 'Could not find CreativeBrief interface.' }
if (-not $content.Contains('interface CameraProfile {')) {
  $cameraInterface = @'

interface CameraProfile {
  clipId: string;
  shotCharacter: string;
  framingCharacter: string;
  motionCharacter: string;
  subjectVisibility: string;
  strengths: string[];
  cautions: string[];
  confidence: number;
}
'@
  $content = $content.Replace($creativeInterfaceMarker, $creativeInterfaceMarker + $cameraInterface)
}

$schemaInsertMarker = 'function buildSectionPlanSchema('
$schemaPos = $content.IndexOf($schemaInsertMarker)
if ($schemaPos -lt 0) { throw 'Could not find section-plan schema builder.' }
if (-not $content.Contains('function buildCameraProfileSchema(')) {
  $cameraSchema = @'
function buildCameraProfileSchema(clipIds: string[]): JsonObject {
  const variants = clipIds.map((clipId) => ({
    type: "object",
    additionalProperties: false,
    required: ["clipId", "shotCharacter", "framingCharacter", "motionCharacter", "subjectVisibility", "strengths", "cautions", "confidence"],
    properties: {
      clipId: { const: clipId },
      shotCharacter: { type: "string", maxLength: 180 },
      framingCharacter: { type: "string", maxLength: 180 },
      motionCharacter: { type: "string", maxLength: 180 },
      subjectVisibility: { type: "string", maxLength: 180 },
      strengths: { type: "array", maxItems: 6, items: { type: "string", maxLength: 180 } },
      cautions: { type: "array", maxItems: 6, items: { type: "string", maxLength: 180 } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  }));

  return {
    type: "object",
    additionalProperties: false,
    required: ["profiles"],
    properties: {
      profiles: {
        type: "array",
        minItems: clipIds.length,
        maxItems: clipIds.length,
        items: { oneOf: variants },
      },
    },
  };
}

'@
  $content = $content.Substring(0, $schemaPos) + $cameraSchema + $content.Substring($schemaPos)
}

# Add parser/validator for camera profiles before section-plan parsing.
$parseMarker = 'function parseSectionPlan('
$parsePos = $content.IndexOf($parseMarker)
if ($parsePos -lt 0) { throw 'Could not find section-plan parser.' }
if (-not $content.Contains('function parseCameraProfiles(')) {
  $cameraParser = @'
function parseCameraProfiles(text: string, clipIds: string[]): CameraProfile[] {
  const parsed = asObject(JSON.parse(text), "camera profile response");
  const rawProfiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  if (rawProfiles.length !== clipIds.length) {
    throw new Error(`FREEOS returned ${rawProfiles.length} camera profiles for ${clipIds.length} clips.`);
  }

  const allowed = new Set(clipIds);
  const seen = new Set<string>();
  const profiles = rawProfiles.map((item, index): CameraProfile => {
    const profile = asObject(item, `camera profile ${index}`);
    const clipId = typeof profile.clipId === "string" ? profile.clipId : "";
    if (!allowed.has(clipId)) throw new Error(`Camera profile ${index} references unknown clip '${clipId}'.`);
    if (seen.has(clipId)) throw new Error(`Camera profile duplicated clip '${clipId}'.`);
    seen.add(clipId);
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 6) : [];
    return {
      clipId,
      shotCharacter: typeof profile.shotCharacter === "string" ? profile.shotCharacter.slice(0, 240) : "unknown",
      framingCharacter: typeof profile.framingCharacter === "string" ? profile.framingCharacter.slice(0, 240) : "unknown",
      motionCharacter: typeof profile.motionCharacter === "string" ? profile.motionCharacter.slice(0, 240) : "unknown",
      subjectVisibility: typeof profile.subjectVisibility === "string" ? profile.subjectVisibility.slice(0, 240) : "unknown",
      strengths: strings(profile.strengths),
      cautions: strings(profile.cautions),
      confidence: Math.max(0, Math.min(1, number(profile.confidence, 0.5))),
    };
  });

  for (const clipId of clipIds) if (!seen.has(clipId)) throw new Error(`Camera profile missing clip '${clipId}'.`);
  return profiles;
}

'@
  $content = $content.Substring(0, $parsePos) + $cameraParser + $content.Substring($parsePos)
}

# Replace the old raw camera-summary director input with a dedicated camera interpretation pass.
$summaryStart = '  const summaries = videos.map((video) => ({'
$briefStart = '  const briefSystem = `'
$summaryPos = $content.IndexOf($summaryStart)
$briefPos = $content.IndexOf($briefStart, $summaryPos)
if ($summaryPos -lt 0 -or $briefPos -lt 0) { throw 'Could not locate camera summaries/director pass.' }

$cameraPass = @'
  const clipIds = included.map((clip) => clip.id);
  const cameraEvidence = videos.map((video) => ({
    clipId: String(video.id),
    timelineAvailability: {
      start: video.timelineAvailableStart,
      end: video.timelineAvailableEnd,
    },
    measuredSemanticSummary: video.summary,
    measuredQualityFlags: video.qualityFlags,
    analyzerNotes: video.semanticNotes,
    statisticsNote: "Any keys named p10, p50, or p90 are statistical percentiles, never clip ids or segment ids.",
  }));

  const cameraProfileSystem = `You are FREEOS's camera interpretation pass. Produce exactly one grounded visual profile for every supplied clipId and use only those clip ids. Never treat metric/statistic names such as p10, p50, p90, mean, sharpness, brightness, or motion as media identifiers. Describe only what the supplied measured semantic/technical evidence supports. Do not invent performer identity, lyrics, audience behavior, story events, transitions, fades, dissolves, or intent. Distinguish uncertain/unknown evidence explicitly. Do not rank cameras globally; characterize how each camera can function editorially based on its measured visual behavior.`;
  const cameraProfileText = await generateJson({
    system: cameraProfileSystem,
    prompt: {
      validClipIds: clipIds,
      cameras: cameraEvidence,
    },
    schema: buildCameraProfileSchema(clipIds),
    timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000),
    numPredict: 1800,
    temperature: 0.12,
  });
  const cameraProfiles = parseCameraProfiles(cameraProfileText, clipIds);

'@
$content = $content.Substring(0, $summaryPos) + $cameraPass + $content.Substring($briefPos)

# Make the creative-director pass consume interpreted camera profiles only, not raw percentile-bearing summaries.
$content = $content.Replace('clips: summaries,', 'cameraProfiles,')
$content = $content.Replace('song-level evidence, and camera summaries.', 'song-level evidence, and grounded camera profiles.')
$content = $content.Replace('Treat shotScale, framingRole, motionRole, person evidence, and their confidence values as measured local visual inferences only.', 'Treat the supplied cameraProfiles as grounded visual interpretations derived from measured local evidence.')

# Feed camera profiles into every section so the editor reasons about camera character plus moment evidence.
$sectionPromptNeedle = @'
      availability,
      evidence,
'@
if (-not $content.Contains($sectionPromptNeedle)) { throw 'Could not find primary section prompt.' }
$content = $content.Replace($sectionPromptNeedle, @'
      availability,
      cameraProfiles: cameraProfiles.filter((profile) => availability.some((item) => String(item.id) === profile.clipId)),
      evidence,
'@)

$retryPromptNeedle = @'
          availability,
          evidence,
          previousFailure: failure,
'@
if (-not $content.Contains($retryPromptNeedle)) { throw 'Could not find retry section prompt.' }
$content = $content.Replace($retryPromptNeedle, @'
          availability,
          cameraProfiles: cameraProfiles.filter((profile) => availability.some((item) => String(item.id) === profile.clipId)),
          evidence,
          previousFailure: failure,
'@)

# Tighten section-editor epistemics and caution policy.
$sectionGuard = 'Technical metrics are evidence, not a shot-ranking formula.'
if (-not $content.Contains($sectionGuard)) { throw 'Could not find semantic section guard.' }
$content = $content.Replace($sectionGuard, $sectionGuard + ' Camera profiles describe visual character, not a mandatory ranking. Cautions may mention only measured source availability, measured quality issues, or semantic uncertainty; never speculate about fades, dissolves, overlapping audio, lyrics, or unseen transition intent.')

# Deterministically strip unsupported speculative cautions if the model still emits them.
$oldCautionFilter = '...sectionCautions.filter((caution) => !/^Section must begin with a switch|^Previous section ends at/i.test(caution)),'
$newCautionFilter = '...sectionCautions.filter((caution) => !/^Section must begin with a switch|^Previous section ends at/i.test(caution) && !/(fade|dissolve|overlapping audio|lyric|transition at|jump cut|exact intent)/i.test(caution)),'
if ($content.Contains($oldCautionFilter)) {
  $content = $content.Replace($oldCautionFilter, $newCautionFilter)
}

# Bump planner identity and evidence.
$content = $content.Replace('version: "freeos-creative-planner-v5.1-semantic-opening"', 'version: "freeos-creative-planner-v5.2-camera-profiles"')
$content = $content.Replace('plannerMode: "academy-guided-staged-semantic-opening-switchpoints"', 'plannerMode: "academy-guided-camera-profile-semantic-switchpoints"')
$plannerModeReturn = '      plannerMode: "academy-guided-camera-profile-semantic-switchpoints",'
if (-not $content.Contains($plannerModeReturn)) { throw 'Planner mode bump did not apply.' }
$content = $content.Replace($plannerModeReturn, $plannerModeReturn + "`r`n      cameraProfileCount: cameraProfiles.length,")

$required = @(
  'interface CameraProfile {',
  'function buildCameraProfileSchema(',
  'function parseCameraProfiles(',
  'statisticsNote: "Any keys named p10, p50, or p90 are statistical percentiles, never clip ids or segment ids."',
  'cameraProfiles: cameraProfiles.filter',
  'freeos-creative-planner-v5.2-camera-profiles',
  'cameraProfileCount: cameraProfiles.length'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.2 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.2 grounded camera profiles.' -ForegroundColor Green
