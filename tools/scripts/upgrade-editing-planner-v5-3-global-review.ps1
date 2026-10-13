$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\..\apps\api-server\src\services\editingPlanner.service.ts'
$path = [System.IO.Path]::GetFullPath($path)
$content = Get-Content -LiteralPath $path -Raw

if ($content.Contains('freeos-creative-planner-v5.3-global-review')) {
  Write-Host '[FREEOS] Editing Planner v5.3 global review is already installed.' -ForegroundColor Yellow
  exit 0
}

if (-not $content.Contains('freeos-creative-planner-v5.2-camera-profiles')) {
  throw 'Planner v5.2 camera profiles must be installed before applying v5.3 global review.'
}

# Extend evidence contract so output proves the finishing pass ran.
$evidenceMarker = '    cameraProfileCount?: number;'
if (-not $content.Contains($evidenceMarker)) { throw 'Could not find v5.2 evidence contract.' }
if (-not $content.Contains('assemblyReviewApplied?: boolean;')) {
  $content = $content.Replace($evidenceMarker, $evidenceMarker + "`r`n    assemblyReviewApplied?: boolean;")
}

# Add a whole-assembly schema. This is a finishing pass over the staged draft, not a second raw-footage planner.
$schemaMarker = 'function buildSectionPlanSchema('
$schemaPos = $content.IndexOf($schemaMarker)
if ($schemaPos -lt 0) { throw 'Could not find section schema builder.' }
if (-not $content.Contains('function buildAssemblyReviewSchema(')) {
  $schema = @'
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

  if (!openingVariants.length) throw new Error('No video source is available at timeline start.');
  return {
    type: "object",
    additionalProperties: false,
    required: ["opening", "switches"],
    properties: {
      opening: { oneOf: openingVariants },
      switches: {
        type: "array",
        maxItems: 48,
        items: { oneOf: switchVariants },
      },
    },
  };
}

'@
  $content = $content.Substring(0, $schemaPos) + $schema + $content.Substring($schemaPos)
}

# Add deterministic user-facing cautions based only on measured analyzer evidence.
$sectionEvidenceMarker = 'function sectionEvidence('
$sectionEvidencePos = $content.IndexOf($sectionEvidenceMarker)
if ($sectionEvidencePos -lt 0) { throw 'Could not find sectionEvidence.' }
if (-not $content.Contains('function buildGroundedCautions(')) {
  $grounded = @'
function buildGroundedCautions(videos: JsonObject[], duration: number, availableEnd: number): string[] {
  const cautions: string[] = [];
  for (const video of videos) {
    const id = String(video.id);
    const flags = Array.isArray(video.qualityFlags) ? video.qualityFlags as JsonObject[] : [];
    const kinds = Array.from(new Set(flags.map((flag) => typeof flag.kind === "string" ? flag.kind : "").filter(Boolean)));
    if (kinds.length) cautions.push(`${id}: measured source-quality flags include ${kinds.join(", ")}.`);
    const notes = Array.isArray(video.semanticNotes) ? video.semanticNotes.filter((v): v is string => typeof v === "string").slice(0, 2) : [];
    for (const note of notes) cautions.push(`${id}: analyzer note — ${note}`);
  }
  if (availableEnd < duration - 0.05) {
    cautions.push(`No supplied video source covers the final ${(duration - availableEnd).toFixed(2)} seconds of the requested duration; FREEOS did not invent coverage.`);
  }
  return Array.from(new Set(cautions)).slice(0, 50);
}

'@
  $content = $content.Substring(0, $sectionEvidencePos) + $grounded + $content.Substring($sectionEvidencePos)
}

# Replace post-section assembly handling with a whole-edit finishing review.
$normalizeMarker = '  const normalizedDecisions: EditingDecision[] = [];'
$normalizePos = $content.IndexOf($normalizeMarker)
if ($normalizePos -lt 0) { throw 'Could not find v5 normalized decision block.' }
$overlapEndMarker = '  const cautions = Array.from(new Set(['
$overlapEndPos = $content.IndexOf($overlapEndMarker, $normalizePos)
if ($overlapEndPos -lt 0) { throw 'Could not find caution block after normalized decisions.' }

$newAssemblyBlock = @'
  const boundaryContexts = [48, 96, 144]
    .filter((boundary) => boundary > 0 && boundary < availableEnd)
    .map((boundary) => ({
      boundary,
      context: sectionEvidence(audio, videos, Math.max(0, boundary - 8), Math.min(availableEnd, boundary + 8)),
    }));

  let assemblyReviewApplied = false;
  let reviewedDecisions = decisions;
  try {
    const assemblySystem = `You are FREEOS's senior finishing editor. Review the staged draft as ONE continuous performance edit from 0 to ${availableEnd.toFixed(3)} seconds. The 48/96/144-second section boundaries are internal planning artifacts, not creative events. Remove boundary-driven switch bursts, redundant same-purpose cuts, and switches that exist only because a section ended. Preserve a long hold when it is creatively justified; preserve a brief burst only when the supplied evidence clearly motivates it. Do not invent lyrics, fades, dissolves, detected cuts, overlapping audio, performer identity, audience behavior, or unseen events. Camera profiles describe visual character, not rankings. Output a complete chronological opening plus later switchpoints. Every chosen clip must remain source-available until the next switch. You are revising FREEOS's own draft, not detecting edits already present in the footage.`;
    const assemblyText = await generateJson({
      system: assemblySystem,
      prompt: {
        userIntent: intent,
        creativeBrief: brief,
        cameraProfiles,
        draftDecisions: decisions,
        boundaryContexts,
        audioOverview: {
          tempo: audio.tempo,
          loudness: audio.loudness,
          silences: audio.silences,
        },
        availability: videos.map((video) => ({ id: video.id, start: video.timelineAvailableStart, end: video.timelineAvailableEnd })),
      },
      schema: buildAssemblyReviewSchema(availableEnd, videos),
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000),
      numPredict: 2600,
      temperature: 0.12,
    });
    const parsedAssembly = parseSectionPlan(assemblyText);
    reviewedDecisions = validateSectionSwitches(parsedAssembly.opening, parsedAssembly.switches, allowedClipIds, 0, availableEnd, videos);
    assemblyReviewApplied = true;
  } catch (error) {
    console.error(`[FREEOS Editing Planner] global assembly review failed; preserving valid staged draft: ${error instanceof Error ? error.message : String(error)}`);
  }

  const normalizedDecisions: EditingDecision[] = [];
  for (const decision of reviewedDecisions) {
    const previous = normalizedDecisions.at(-1);
    if (previous && previous.clipId === decision.clipId && previous.action === decision.action && Math.abs(previous.end - decision.start) <= 0.02) {
      previous.end = decision.end;
      previous.confidence = Math.min(previous.confidence, decision.confidence);
      if (!previous.rationale && decision.rationale) previous.rationale = decision.rationale;
      continue;
    }
    normalizedDecisions.push({ ...decision });
  }
  for (let i = 1; i < normalizedDecisions.length; i++) {
    if (normalizedDecisions[i].start < normalizedDecisions[i - 1].end - 0.01) {
      throw new Error(`Combined planner decisions overlap near ${normalizedDecisions[i].start}.`);
    }
  }

'@
$content = $content.Substring(0, $normalizePos) + $newAssemblyBlock + $content.Substring($overlapEndPos)

# Replace model-authored cautions with grounded analyzer cautions only.
$cautionStart = $content.IndexOf('  const cautions = Array.from(new Set([')
if ($cautionStart -lt 0) { throw 'Could not find caution construction.' }
$cautionEndMarker = '  return {'
$cautionEnd = $content.IndexOf($cautionEndMarker, $cautionStart)
if ($cautionEnd -lt 0) { throw 'Could not find return after cautions.' }
$cautionReplacement = "  const cautions = buildGroundedCautions(videos, duration, availableEnd);`r`n`r`n"
$content = $content.Substring(0, $cautionStart) + $cautionReplacement + $content.Substring($cautionEnd)

# Tighten director language so creative summary cannot treat inferred camera character as detected editorial events.
$content = $content.Replace('The academy is judgment guidance, not a preset.', 'The academy is judgment guidance, not a preset. Describe intended editorial strategy only; never claim that cuts, transitions, focus pulls, audience actions, or performance events were detected unless the supplied evidence explicitly contains them.')

# Bump planner identity and evidence.
$content = $content.Replace('version: "freeos-creative-planner-v5.2-camera-profiles"', 'version: "freeos-creative-planner-v5.3-global-review"')
$content = $content.Replace('plannerMode: "academy-guided-camera-profile-semantic-switchpoints"', 'plannerMode: "academy-guided-camera-profile-global-review"')
$profileCountMarker = '      cameraProfileCount: cameraProfiles.length,'
if (-not $content.Contains($profileCountMarker)) { throw 'Could not find cameraProfileCount return field.' }
$content = $content.Replace($profileCountMarker, $profileCountMarker + "`r`n      assemblyReviewApplied,")

$required = @(
  'function buildAssemblyReviewSchema(',
  'function buildGroundedCautions(',
  'global assembly review failed; preserving valid staged draft',
  'boundary-driven switch bursts',
  'freeos-creative-planner-v5.3-global-review',
  'assemblyReviewApplied,'
  'const cautions = buildGroundedCautions(videos, duration, availableEnd);'
)
foreach ($needle in $required) {
  if (-not $content.Contains($needle)) { throw "v5.3 upgrade incomplete; missing: $needle" }
}

Set-Content -LiteralPath $path -Value $content -Encoding UTF8
Write-Host '[FREEOS] Editing Planner upgraded to v5.3 global finishing review.' -ForegroundColor Green
