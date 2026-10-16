import { config } from "../config";
import { bootstrapEditingAcademy, buildEditingKnowledgeContext } from "./editingAcademy.service";
import type { EditingPlannerClipInput, EditingPlannerRequest, EditingDecision, EditingPlan, CreativeBrief, JsonObject } from "./editing/planning/plannerTypes";
export type { EditingPlannerClipInput, EditingPlannerRequest, EditingDecision, EditingPlan } from "./editing/planning/plannerTypes";
import { number, asObject } from "./editing/shared";
import { compactAudio } from "./editing/evidence/audioEvidence";
import { compactVideo } from "./editing/evidence/videoEvidence";
import { buildSectionEditMoments } from "./editing/evidence/candidateMoments";
import { sectionEvidence } from "./editing/evidence/sectionEvidence";
import { buildEvidenceCatalog } from "./editing/evidence/evidenceRefs";
import { openingEvidenceByClip, resolveOpeningEvidenceScope } from "./editing/evidence/openingEvidence";
import { creativeBriefSchema, buildCameraProfileSchema, buildSectionPlanSchema, buildBoundaryPruneSchema } from "./editing/planning/schemas";
import { parseCreativeBrief, parseCameraProfiles, parseSectionPlan } from "./editing/planning/parsing";
import { sanitizeGroundedEditorialText, sanitizeStructuredStrings, validateSectionSwitches, SectionValidationError } from "./editing/validation/section";
import { appendSectionDecisions, assertNonDegenerateAssembly, buildGroundedCautions, mergeAdjacentDecisions } from "./editing/critique/assembly";
import { generateJson } from "./editing/planning/model";
import { analyzeMediaCached } from "./editing/evidence/mediaCache";
import { classifyProject } from "./editing/classification/projectClassifier";
import { resolveEditingIntent } from "./editing/classification/projectIntent";
import { factualEvidenceSummary } from "./editing/critique/factualSummary";
import { recordEditingExperience } from "./editing/learning/editingExperience";
import { runBoundedPlanRepair, PlanRepairError } from "./editing/repair/planRepair";
import { buildSectionPacket, estimatePromptTokens } from "./editing/planning/sectionPacket";
import { buildCandidateSupportIndex } from "./editing/evidence/targetSupport";
import { runGlobalEditorialRepair } from "./editing/repair/globalEditorialRepair";
import { deterministicOpening, availableOpeningClips } from "./editing/planning/openingState";

export async function buildCreativeEditPlan(input: EditingPlannerRequest): Promise<EditingPlan> {
  const startedAt = Date.now();
  const telemetry = { modelCalls: 0, modelElapsedMs: 0, mediaCacheHits: 0, candidateMomentCount: 0, candidateSupportCount: 0, candidateNoAlternativeSupportCount: 0, averageSupportedDestinations: 0, minimumSupportedDestinations: 0, maximumSupportedDestinations: 0, targetGroundingRepairAlternatives: 0, nonLocalRepairFailures: 0, supportIndexCompactionCount: 0, sectionAttempts: 0, evidenceRefCount: 0, invalidEvidenceRefFailures: 0, nonLocalEvidenceRefFailures: 0, targetGroundingFailures: 0, globalEditorialRepairPasses: 0, criticFindingsBeforeRepair: [] as string[], criticFindingsAfterRepair: [] as string[], resolvedCriticFindings: [] as string[], unresolvedMaterialFindings: [] as string[], academySelectionReasons: [] as unknown[], validationFailures: {} as Record<string, number>, repairAttemptsByCategory: {} as Record<string, number>, criticFindings: [] as string[], initialSelection: undefined as undefined | { openingMode: "initial-selection"; timelineStart: number; openingEvidenceWindowStart: number; openingEvidenceWindowEnd: number; availableOpeningClips: string[]; openingEvidenceCountsByClip: Record<string, number>; selectedClipId: string; selectedEvidenceRefs: string[] } };
  const callModel = async (request: Parameters<typeof generateJson>[0]) => {
    const start = Date.now();
    try { return await generateJson({ ...request, onCall: () => { telemetry.modelCalls++; } }); }
    finally { telemetry.modelElapsedMs += Date.now() - start; }
  };
  if (!input.audioPath?.trim()) throw new Error("audioPath is required.");
  const included = input.clips.filter((clip) => !clip.exclude);
  if (!included.length) throw new Error("At least one non-excluded clip is required.");
  if (new Set(included.map((clip) => clip.id)).size !== included.length) throw new Error("Clip ids must be unique.");

  const intentLayers = resolveEditingIntent(input);
  const intent = intentLayers.projectIntent;
  const sampleFps = Math.max(0.5, Math.min(4, input.sampleFps ?? 2));
  const analyzed = await Promise.all([
    analyzeMediaCached("audio", input.audioPath),
    ...included.map((clip) => analyzeMediaCached("video", clip.path, sampleFps)),
  ]);
  telemetry.mediaCacheHits = analyzed.filter((item) => item.cacheHit).length;
  const [audioRaw, ...videoRaw] = analyzed.map((item) => item.result);
  const audio = compactAudio(audioRaw);
  const videos = videoRaw.map((raw, index) => compactVideo(raw, included[index]));
  const profile = classifyProject(input, videos, audio);
  bootstrapEditingAcademy();
  const editingKnowledge = buildEditingKnowledgeContext(profile.academyQuery);
  telemetry.academySelectionReasons = editingKnowledge.gap.selectionReasons;
  if (editingKnowledge.gap.needsMoreKnowledge) throw new Error(`Editing Academy knowledge gap: ${editingKnowledge.gap.reason} Query: ${editingKnowledge.gap.query}`);
  const sectionAcademy = buildEditingKnowledgeContext(`${profile.academyQuery} section camera continuity evidence pacing`, 4).context;
  const inferredDuration = number(audio.durationSeconds, 0);
  const duration = input.durationSeconds && input.durationSeconds > 0 ? input.durationSeconds : inferredDuration;
  if (!duration) throw new Error("Could not determine edit duration.");

  const availableEnd = Math.min(duration, Math.max(...videos.map((video) => number(video.timelineAvailableEnd, 0))));
  const allowedClipIds = new Set(included.map((clip) => clip.id));
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

  const cameraProfileSystem = `You are FREEOS's camera interpretation pass.

Produce exactly one grounded VISUAL profile for every supplied clipId and use only supplied clip ids.

STRICT EVIDENCE RULES:
- Describe only supplied measured visual or technical evidence.
- A detected face is only a detected face.
- Multiple detected faces are only multiple detected faces.
- Never call a detected person a performer, singer, musician, audience member, actor, or any other role.
- Never call multiple faces an ensemble, group performance, backing singers, crowd, or audience.
- Never invent lyrics, vocals, instruments, gestures, emotional expressions, story events, relationships, actions, or intent.
- Never invent rooms, stages, venues, environments, props, or unseen objects.
- Never convert face counts into story semantics.
- Never convert audio statistics into story semantics.
- Use neutral language such as tighter framing, wider framing, detected faces, face presence, centered-face ratio, motion, motion shift, scene-change evidence, brightness, sharpness, quality flags, and uncertainty.
- Metric/statistic names such as p10, p50, p90, mean, sharpness, brightness, and motion are not media identifiers.
- Do not rank cameras globally.
- Describe editorial utility only when directly supported by measured visual behavior.

Return only schema-valid JSON.`;
  const cameraProfileText = await callModel({
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
  const cameraProfiles =
    parseCameraProfiles(
      cameraProfileText,
      clipIds
    ).map(
      (profile) =>
        sanitizeStructuredStrings(
          profile
        )
    );
  const briefSystem = `You are FREEOS's senior editing director.

Build a concise editorial strategy from:
- the user's intent
- owner-approved Editing Academy guidance
- measured audio analysis
- grounded camera profiles

Do NOT output cuts yet.

EVIDENCE DISCIPLINE:
- Never invent lyrics or lyric moments.
- Never invent verse, chorus, bridge, pre-chorus, breakdown, hook, or outro labels unless those exact labels were supplied by measured analysis.
- Never invent performers, singers, backing singers, musicians, instruments, audience members, crowd behavior, rooms, objects, gestures, actions, or story events.
- Never infer a vocal flourish, harmony entrance, instrumental entrance, solo, chord change, melody event, or lyric emphasis unless supplied evidence explicitly identifies it.
- Face presence means only measured face presence.
- Multiple faces means only multiple detected faces.
- Multiple faces do not prove singers, audience, group roles, or ensemble behavior.
- Use neutral evidence language: audio energy change, measured transient, detected audio boundary, silence boundary, visual motion shift, framing change, scene change, face presence, source availability.
- If evidence is uncertain, say it is uncertain.

EDITORIAL JUDGMENT:
- Editing Academy guidance is not a preset.
- Camera profiles describe visual behavior, not rankings.
- Do not establish fixed cut cadence.
- Do not mechanically rotate cameras.
- Strong shots may hold.
- Faster cutting must arise from evidence density, not elapsed time.

${editingKnowledge.context}`;
  const briefText = await callModel({
    system: briefSystem,
    prompt: {
      project: input.project,
      sequence: input.sequence,
      userIntent: intent,
      intentLayers,
      durationSeconds: duration,
      editableDurationSeconds: availableEnd,
      audio: { tempo: audio.tempo, loudness: audio.loudness, sections: audio.sections, silenceRegions: audio.silenceRegions, intro: audio.intro, outro: audio.outro },
      cameraProfiles,
    },
    schema: creativeBriefSchema,
    timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000),
    numPredict: 1000,
    temperature: 0.25,
  });
  const rawBrief =
    parseCreativeBrief(
      briefText
    );

  const brief: CreativeBrief = {
    creativeSummary:
      sanitizeGroundedEditorialText(
        rawBrief.creativeSummary
      ),

    principles:
      rawBrief.principles.map(
        (item) =>
          sanitizeGroundedEditorialText(
            item
          )
      ),

    cautions:
      rawBrief.cautions.map(
        (item) =>
          sanitizeGroundedEditorialText(
            item
          )
      ),
  };

  const sectionSeconds = 60;
  const decisions: EditingDecision[] = [];
  const allCandidateEditMoments: JsonObject[] = [];
  let previousClipId = "";
  for (let sectionStart = 0; sectionStart < availableEnd; sectionStart += sectionSeconds) {
    const sectionEnd = Math.min(availableEnd, sectionStart + sectionSeconds);
    const availability = videos.map((video) => ({
      id: video.id, start: video.timelineAvailableStart, end: video.timelineAvailableEnd,
    })).filter((video) => number(video.end, 0) > sectionStart && number(video.start, 0) < sectionEnd);

    /*
     * Real evidence-backed editing opportunities.
     * These are options, never mandatory cuts.
     */
    const candidateEditMoments =
      buildSectionEditMoments(
        audio,
        videos,
        sectionStart,
        sectionEnd
      );
    telemetry.candidateMomentCount += candidateEditMoments.length;
    allCandidateEditMoments.push(...candidateEditMoments);

    const candidateEditTimes =
      candidateEditMoments
        .map(
          (moment) =>
            number(
              moment.at,
              NaN
            )
        )
        .filter(
          (value) =>
            Number.isFinite(value)
        );
    const openingScope = sectionStart === 0 ? resolveOpeningEvidenceScope(videos, sectionStart) : undefined;
    const evidenceCatalog = buildEvidenceCatalog(audio, videos, sectionStart, sectionEnd, candidateEditTimes, openingScope);
    const fixedOpening = deterministicOpening(previousClipId, videos, sectionStart);
    const openingMode = fixedOpening?.mode ?? (previousClipId ? "availability-transition" : "initial-selection");
    const openingSourceAvailable = fixedOpening ? availableOpeningClips(videos, sectionStart).includes(fixedOpening.clipId) : undefined;


    const sectionSystem = `You are FREEOS's section editor.

Create ONE chronological edit for ONLY timeline ${sectionStart.toFixed(3)} to ${sectionEnd.toFixed(3)}.

SECTION CONTINUITY:
- The start of this planning section is NOT automatically a creative cut.
- previousClipId is the camera active immediately before this section.
- Current opening state: ${fixedOpening ? `${fixedOpening.mode}, clip '${fixedOpening.clipId}'. This is fixed system state; return switches only and do not justify this opening.` : `Choose an evidence-grounded ${openingMode} opening and return it with mode '${openingMode}'.`}
- For initial-selection only, compare every available clip's openingEvidence in the packet. Choose the first visual state creatively. Cite measured evidence for the selected clip inside openingEvidence.windowStart-windowEnd. Missing measurements are uncertainty, not evidence.
- A genuine creative switch may happen exactly at sectionStart or later at an evidence-backed candidateEditMoment.
- Never change cameras merely because a planning section began.
- A section boundary alone is not evidence for a creative switch.

LOCAL-EVIDENCE DISCIPLINE:
- Every switch time must come from the enforced evidence-backed candidate schema.
- Select evidenceRefs only from evidenceCatalog. Each switch reference must be within 0.8s of that switch. The initial selection uses only its separate opening evidence scope.
- Every creative switch with multiple available sources needs at least one measured visual evidenceRef for the selected destination clip. Audio supports timing; other cameras support comparison; neither proves the destination. Availability alone supports a switch only when that clip is uniquely available.
- At each candidate, choose a destination only from clips with nonempty targetSupport refs. Cite its supplied local refs. If the active clip remains available, holding it and omitting the candidate is legal.
- On repair, use repair.failedSwitch.supportedDestinations for local alternatives. Never substitute distant refs for the rejected destination.
- Never justify a switch using an event several seconds earlier or later.
- creativeIntent describes editorial purpose and never proves a factual claim.

CAMERA CONTINUITY:
- Do not create A-B-A or A-B-A-B patterns merely for visual variety.
- A rapid return to the previous camera requires strong local measured evidence.
- Very short inserts require unusually strong local evidence.
- When camera choices are otherwise similar, prefer continuity.

CUT-TIME POLICY:
- candidateEditMoments contains measured editorial opportunities derived from audio transients, detected audio boundaries, silence boundaries, scene changes, motion shifts, and source boundaries.
- Candidate edit moments are OPTIONS, not instructions to cut.
- Do NOT cut merely because a candidate exists.
- Do NOT turn candidate times into a repeating cadence.
- Do NOT approximate fixed spacing such as every 4, 8, or 16 seconds.
- Let actual evidence density and visual usefulness determine pacing.
- Long holds are valid.
- Several strong measured events close together may justify faster cutting.

HARD TIMELINE RULES:
- The opening state applies at ${sectionStart.toFixed(3)}; return an opening field only when the schema requests it.
- A selected clip may remain active ONLY inside supplied source availability.
- Switch away no later than a source's availableEnd.
- The final active clip MUST be one of sectionEndCapableClipIds.
- Never assume source coverage beyond supplied values.
- Use absolute timeline seconds.

GROUNDING RULES:
- Never invent lyrics.
- Never invent verse, chorus, bridge, hook, or other song labels.
- Never invent singers, backing singers, performers, audience, instruments, rooms, objects, actions, story events, or emotional expressions.
- Multiple detected faces do NOT prove an ensemble or backing singers.
- Face presence does NOT identify a vocalist or performer.
- Do not write factual rationale prose. Choose measured evidenceRefs; FREEOS renders rationale locally after validation.
- Do not add extra free-text fields to opening or switches.
- Never claim a vocal flourish, lyrical emphasis, instrumental entrance, harmony, solo, chord, or melody event unless supplied evidence explicitly contains that fact.
- If semantic evidence is uncertain, say so.

CREATIVE RULES:
- Do not mechanically alternate cameras.
- Do not rank cameras using one metric.
- Technical metrics are evidence, not an editing formula.
- Keep a shot when it remains the strongest editorial choice.
- Switch only when evidence and creative strategy justify changing what the viewer receives.

Return only schema-valid JSON.`;
    const sectionProfiles = cameraProfiles.filter((profile) => availability.some((item) => String(item.id) === profile.clipId));

    let sectionText = "";

    let parsedSection:
      {
        opening: unknown;
        switches: unknown[];
        cautions: string[];
      }
      | undefined;

    let sectionDecisions:
      EditingDecision[]
      | undefined;

    /*
     * FREEOS may repair a rejected creative section several times.
     *
     * Validation rules stay strict. We regenerate the model output
     * rather than weakening evidence, continuity, semantic, source,
     * timing, or anti-ping-pong standards.
     */
    const maxSectionAttempts = 4;

    let previousFailure = "";
    let previousCategory = "";
    let previousResponseExcerpt = "";
    let failedSwitch: { at: number; clipId: string; candidateId: string | null; currentClipId: string; supportedDestinations: Record<string, string[]>; holdAllowed: boolean } | undefined;
    let failedCombination = "";
    const fullSupport = buildCandidateSupportIndex(candidateEditMoments, evidenceCatalog, videos);
    const counts = fullSupport.map((item) => Object.values(item.targetSupport).filter((refs) => refs.length).length);
    const baselineClipId = fixedOpening?.clipId ?? previousClipId;
    const alternativeCounts = fullSupport.map((item) => Object.entries(item.targetSupport).filter(([id, refs]) => id !== baselineClipId && refs.length).length);
    telemetry.candidateSupportCount += counts.filter((count) => count > 0).length;
    telemetry.candidateNoAlternativeSupportCount += alternativeCounts.filter((count) => count === 0).length;
    telemetry.averageSupportedDestinations = (telemetry.averageSupportedDestinations * (telemetry.candidateMomentCount - counts.length) + counts.reduce((sum, count) => sum + count, 0)) / Math.max(1, telemetry.candidateMomentCount);
    if (counts.length) {
      telemetry.minimumSupportedDestinations = Math.min(telemetry.candidateMomentCount > counts.length ? telemetry.minimumSupportedDestinations : Infinity, ...counts);
      telemetry.maximumSupportedDestinations = Math.max(telemetry.maximumSupportedDestinations, ...counts);
    }
    console.log("[FREEOS Editing Planner] candidate support", JSON.stringify({ candidateCount: counts.length, baselineClipId: baselineClipId || null, candidateWithAlternativeSupportCount: alternativeCounts.filter((count) => count > 0).length, candidateWithNoAlternativeSupportCount: alternativeCounts.filter((count) => count === 0).length, averageSupportedDestinations: counts.reduce((sum, count) => sum + count, 0) / Math.max(1, counts.length), minimumSupportedDestinations: counts.length ? Math.min(...counts) : 0, maximumSupportedDestinations: Math.max(0, ...counts) }));

    try {
      const repaired = await runBoundedPlanRepair({
        maxAttempts: maxSectionAttempts,
        generate: async (attempt, previous) => {
          telemetry.sectionAttempts++;
          previousFailure = previous?.message ?? "";
          previousCategory = previous?.category ?? "";
          if (previousCategory) telemetry.repairAttemptsByCategory[previousCategory] = (telemetry.repairAttemptsByCategory[previousCategory] ?? 0) + 1;
      const isRepair =
        attempt > 1;

      const attemptSystem = sectionSystem + (isRepair
        ? "\nRepair the previous decision against the validator diagnostic. Return one complete section JSON."
        : "");
      const packet = buildSectionPacket({
        start: sectionStart, end: sectionEnd, videos, availability,
        candidates: candidateEditMoments, catalog: evidenceCatalog,
        openingScope,
        intent, brief, profiles: sectionProfiles, previousClipId,
        academy: sectionAcademy, system: attemptSystem, numPredict: 2200,
        ...(isRepair ? { repair: {
          category: previousCategory, message: previousFailure.slice(0, 800),
          rejected: previousResponseExcerpt.slice(0, 1200), ...(failedSwitch ? { failedSwitch } : {}),
        } } : {}),
      });
      if (packet.compactionApplied) telemetry.supportIndexCompactionCount++;
      telemetry.supportIndexCompactionCount += packet.supportIndexCompactionCount;
      console.log("[FREEOS Editing Planner] section packet", JSON.stringify({
        section: `${sectionStart}-${sectionEnd}`,
        rawEvidenceCount: (Array.isArray(audio.windows) ? audio.windows.length : 0) +
          (Array.isArray(audio.transientMoments) ? audio.transientMoments.length : 0) +
          videos.reduce((sum, v) => sum + (Array.isArray(v.windows) ? v.windows.length : 0) +
            (Array.isArray(v.editMoments) ? v.editMoments.length : 0), 0),
        sectionEvidenceCount: evidenceCatalog.length, candidateCount: candidateEditMoments.length,
        catalogEntries: packet.exposedCatalog.length,
        estimatedInputTokens: packet.estimatedPromptTokens, inputBudget: packet.budget.finalInputBudget,
        contextSize: packet.budget.contextSize, outputTokenReserve: packet.budget.outputTokenReserve,
        safetyMargin: packet.budget.safetyMargin, finalInputBudget: packet.budget.finalInputBudget,
        estimatedPromptTokens: packet.estimatedPromptTokens, academyTokens: packet.academyTokens,
        intentTokens: packet.intentTokens, evidenceCatalogTokens: packet.evidenceCatalogTokens,
        candidateTokens: packet.candidateTokens, schemaTokens: packet.schemaTokens,
        compactionApplied: packet.compactionApplied, repairAttempt: attempt,
      }));

          console.log(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} attempt ${attempt}/${maxSectionAttempts}${isRepair ? " repair" : ""}`);
        sectionText =
          await callModel({
            system:
              attemptSystem,

            prompt:
              packet.packet,

            schema:
              packet.schema,

            timeoutMs:
              Math.max(
                config.ollamaGenerateTimeoutMs,
                isRepair
                  ? 150_000
                  : 180_000
              ),

            numPredict:
              2200,

            temperature:
              isRepair
                ? 0.08
                : 0.2,
          });

          return sectionText;
        },
        validate: (generated) => {
          const candidateSection = parseSectionPlan(String(generated));
          const candidateDecisions = validateSectionSwitches(
            candidateSection.opening, candidateSection.switches, allowedClipIds,
            sectionStart, sectionEnd, videos, candidateEditMoments, previousClipId, evidenceCatalog, openingScope
          );
          telemetry.evidenceRefCount += [candidateSection.opening, ...candidateSection.switches].reduce<number>((count, item) => count + (item && typeof item === "object" && Array.isArray((item as JsonObject).evidenceRefs) ? ((item as JsonObject).evidenceRefs as unknown[]).length : 0), 0);
          return { candidateSection, candidateDecisions };
        },
        classify: (error) => {
          if (error instanceof SectionValidationError) return error.category;
          const failure = error instanceof Error ? error.message : String(error);
          return /context-budget|exceed_context_size_error|exceeds available context size/i.test(failure) ? "context-budget"
            : /timeout|ECONN|fetch failed|socket|network|Ollama.*failed/i.test(failure) ? "runtime"
            : /availab|source|continuation/i.test(failure) ? "source-unavailable"
            : /mechanical|alternat|ping.pong|Short A-B-A/i.test(failure) ? "mechanical-camera-pattern"
            : /ground|semantic|rationale|evidence/i.test(failure) ? "grounding"
            : /boundary|continuity/i.test(failure) ? "continuity"
            : /timing|candidate|time/i.test(failure) ? "timing"
            : "structure";
        },
        onFailure: (diagnostic) => {
          telemetry.validationFailures[diagnostic.category] = (telemetry.validationFailures[diagnostic.category] ?? 0) + 1;
          if (diagnostic.category === "invalid-evidence-reference") telemetry.invalidEvidenceRefFailures++;
          if (diagnostic.category === "non-local-evidence") { telemetry.nonLocalEvidenceRefFailures++; telemetry.nonLocalRepairFailures++; }
          if (diagnostic.category === "target-grounding") telemetry.targetGroundingFailures++;
          failedSwitch = undefined;
          failedCombination = "";
          if (diagnostic.category === "target-grounding" || diagnostic.category === "non-local-evidence") {
            try {
              const rejected = parseSectionPlan(sectionText);
              const match = /Section switch (\d+)/.exec(diagnostic.message);
              const index = match ? Number(match[1]) : -1;
              const selected = rejected.switches[index] as JsonObject | undefined;
              const at = number(selected?.at, NaN);
              const support = fullSupport.find((item) => Math.abs(item.at - at) <= 0.01);
              if (selected && support) {
                const clipId = String(selected.clipId ?? "");
                const earlier = rejected.switches.slice(0, index).filter((item) => number((item as JsonObject).at, NaN) < at).at(-1) as JsonObject | undefined;
                const currentClipId = String(earlier?.clipId ?? (rejected.opening as JsonObject | undefined)?.clipId ?? fixedOpening?.clipId ?? previousClipId);
                failedSwitch = { at, clipId, candidateId: support.candidateId, currentClipId, supportedDestinations: Object.fromEntries(Object.entries(support.targetSupport).filter(([, refs]) => refs.length)), holdAllowed: support.availableClips.includes(currentClipId) };
                failedCombination = `${at}:${clipId}:${JSON.stringify((selected.evidenceRefs as unknown[] | undefined) ?? [])}`;
                telemetry.targetGroundingRepairAlternatives += Object.keys(failedSwitch.supportedDestinations).filter((id) => id !== currentClipId).length;
                console.warn("[FREEOS Editing Planner] switch repair options", JSON.stringify({ category: diagnostic.category, candidateId: support.candidateId, failedDestination: clipId, supportedDestinationsAtCandidate: Object.keys(failedSwitch.supportedDestinations), holdAllowed: failedSwitch.holdAllowed }));
              }
            } catch { /* A malformed response retains the validator diagnostic. */ }
          }
          previousResponseExcerpt = sectionText.slice(0, 2400);
          console.error(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} attempt ${diagnostic.attempt}/${maxSectionAttempts} validation failure: ${diagnostic.message}`);
          sectionText = "";
        },
        failureKey: (diagnostic) => failedCombination && (diagnostic.category === "target-grounding" || diagnostic.category === "non-local-evidence")
          ? failedCombination : undefined,
      });
      parsedSection = repaired.value.candidateSection;
      sectionDecisions = repaired.value.candidateDecisions;
      if (failedSwitch) {
        const repairedFailure = failedSwitch;
        const replacement = parsedSection.switches.find((item) => Math.abs(number((item as JsonObject).at, NaN) - repairedFailure.at) <= 0.01) as JsonObject | undefined;
        const repairAction = replacement ? String(replacement.clipId) === repairedFailure.clipId ? "revised-evidence" : "alternate-destination" : "remove-or-move-switch";
        console.log("[FREEOS Editing Planner] target grounding repair", JSON.stringify({ candidateId: repairedFailure.candidateId, failedDestination: repairedFailure.clipId, repairAction }));
      }
      const acceptedOpeningClipId = fixedOpening?.clipId ?? (parsedSection.opening && typeof parsedSection.opening === "object" ? String((parsedSection.opening as JsonObject).clipId ?? "") : "");
      if (openingScope) {
        const openingEvidence = openingEvidenceByClip(videos, evidenceCatalog, openingScope);
        telemetry.initialSelection = {
          openingMode: "initial-selection", timelineStart: sectionStart,
          openingEvidenceWindowStart: openingScope.start, openingEvidenceWindowEnd: openingScope.end,
          availableOpeningClips: openingScope.availableClipIds,
          openingEvidenceCountsByClip: Object.fromEntries(openingEvidence.map((item) => [item.clipId, item.evidenceRefs.length])),
          selectedClipId: acceptedOpeningClipId,
          selectedEvidenceRefs: parsedSection.opening && typeof parsedSection.opening === "object" && Array.isArray((parsedSection.opening as JsonObject).evidenceRefs) ? (parsedSection.opening as JsonObject).evidenceRefs as string[] : [],
        };
        console.log("[FREEOS Editing Planner] initial selection", JSON.stringify(telemetry.initialSelection));
      }
      console.log("[FREEOS Editing Planner] section boundary", JSON.stringify({
        sectionStart, openingMode, openingClipId: acceptedOpeningClipId,
        openingSourceAvailable: openingSourceAvailable ?? availableOpeningClips(videos, sectionStart).includes(acceptedOpeningClipId),
        creativeSwitchesReturned: parsedSection?.switches.length ?? 0,
        boundarySwitch: parsedSection?.switches.some((item) => item && typeof item === "object" && Math.abs(number((item as JsonObject).at, NaN) - sectionStart) <= 0.001) ?? false,
      }));
      console.log(`[FREEOS Editing Planner] section ${sectionStart}-${sectionEnd} accepted on attempt ${repaired.attempts}/${maxSectionAttempts} with ${sectionDecisions.length} decisions`);
    } catch (error) {
      if (error instanceof PlanRepairError) {
        const last = error.diagnostics.at(-1)!;
        try {
          recordEditingExperience({
            projectKey: input.project, editClass: profile.primary, issue: last.category,
            evidence: last.message, attemptedBehavior: previousResponseExcerpt,
            result: `Section ${sectionStart.toFixed(3)}-${sectionEnd.toFixed(3)} failed validation after ${last.attempt} attempts`,
            proposedLesson: `Review repeated ${last.category} failures for this project before proposing a reusable editing lesson.`,
            confidence: "low", scope: "project",
          });
        } catch (recordError) {
          console.warn("[FREEOS Editing Planner] could not record editing experience", recordError instanceof Error ? recordError.message : String(recordError));
        }
      }
      throw error;
    }

    if (
      !parsedSection ||
      !sectionDecisions
    ) {
      throw new Error(
        `FREEOS section ${sectionStart.toFixed(3)}-${sectionEnd.toFixed(3)} exited the repair loop without an accepted plan.`
      );
    }

    appendSectionDecisions(decisions, sectionDecisions);

    previousClipId =
      decisions.at(-1)?.clipId ??
      previousClipId;
  }

  const internalBoundaries = Array.from({ length: Math.max(0, Math.ceil(availableEnd / sectionSeconds) - 1) }, (_, index) => (index + 1) * sectionSeconds).filter((boundary) => boundary < availableEnd);
  const boundaryContexts = internalBoundaries.map((boundary) => ({
    boundary,
    context: sectionEvidence(audio, videos, Math.max(0, boundary - 8), Math.min(availableEnd, boundary + 8)),
  }));

  let assemblyReviewApplied = false;
  let assemblyReviewFailure: string | undefined;
  let assemblyBoundaryPrunes = 0;
  let reviewedDecisions = decisions.map((decision) => ({ ...decision }));

  try {
    const candidateSwitches = decisions
      .slice(1)
      .filter((decision) => internalBoundaries.some((boundary) => Math.abs(decision.start - boundary) <= 6.001))
      .map((decision) => Number(decision.start.toFixed(3)));

    const uniqueCandidateTimes = Array.from(new Set(candidateSwitches)).sort((a, b) => a - b);
    const candidateDetails = uniqueCandidateTimes.map((at) => {
      const index = decisions.findIndex((decision) => Math.abs(decision.start - at) <= 0.001);
      return {
        at,
        before: index > 0 ? decisions[index - 1] : null,
        after: index >= 0 ? decisions[index] : null,
        nearestBoundary: internalBoundaries.reduce((best, boundary) => Math.abs(boundary - at) < Math.abs(best - at) ? boundary : best, internalBoundaries[0] ?? at),
      };
    });

    const pruneSystem = `You are FREEOS's senior finishing editor performing a SURGICAL boundary cleanup on an already-valid draft. You may only remove existing switchpoints listed in candidateSwitches. Internal planning boundaries are computational artifacts, not creative events. Remove a candidate switch only when it looks like a boundary-driven burst, redundant handoff, or section-end artifact. Do not redesign the whole edit, do not add switchpoints, do not change cameras elsewhere, and do not remove motivated short bursts merely because they are short. Returning an empty removeSwitches array is valid. Camera profiles describe visual character, not rankings.`;

    const pruneText = await callModel({
      system: pruneSystem,
      prompt: {
        userIntent: intent,
        creativeBrief: brief,
        cameraProfiles,
        candidateSwitches: candidateDetails,
        boundaryContexts,
        draftDecisions: decisions,
      },
      schema: buildBoundaryPruneSchema(uniqueCandidateTimes),
      timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 120_000),
      numPredict: 900,
      temperature: 0.08,
    });

    const parsedPrune = asObject(JSON.parse(pruneText), "boundary prune response");
    const requestedRemovals = Array.isArray(parsedPrune.removeSwitches)
      ? parsedPrune.removeSwitches.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : [];
    const allowedRemovalTimes = new Set(uniqueCandidateTimes.map((value) => value.toFixed(3)));

    for (const requestedAt of requestedRemovals.sort((a, b) => a - b)) {
      const at = Number(requestedAt.toFixed(3));
      if (!allowedRemovalTimes.has(at.toFixed(3))) continue;
      const index = reviewedDecisions.findIndex((decision) => Math.abs(decision.start - at) <= 0.001);
      if (index <= 0) continue;

      const previous = reviewedDecisions[index - 1];
      const current = reviewedDecisions[index];
      const previousVideo = videos.find((video) => String(video.id) === previous.clipId);
      const availableEndForPrevious = number(previousVideo?.timelineAvailableEnd, 0);

      // Removing a switch means the preceding shot continues through the removed segment.
      // Reject that removal deterministically if the preceding source cannot cover it.
      if (!previousVideo || current.end > availableEndForPrevious + 0.05) continue;

      previous.end = current.end;
      previous.confidence = Math.min(previous.confidence, current.confidence);
      reviewedDecisions.splice(index, 1);
      assemblyBoundaryPrunes += 1;
    }

    assertNonDegenerateAssembly(reviewedDecisions, decisions);
    assemblyReviewApplied = true;
    assemblyReviewFailure = undefined;
  } catch (error) {
    assemblyReviewFailure = error instanceof Error ? error.message : String(error);
    reviewedDecisions = decisions.map((decision) => ({ ...decision }));
    assemblyBoundaryPrunes = 0;
    console.error(`[FREEOS Editing Planner] surgical boundary review failed; preserving valid staged draft: ${assemblyReviewFailure}`);
  }
  const normalizedDecisions = mergeAdjacentDecisions(reviewedDecisions);
  for (let i = 1; i < normalizedDecisions.length; i++) {
    if (normalizedDecisions[i].start < normalizedDecisions[i - 1].end - 0.01) {
      throw new Error(`Combined planner decisions overlap near ${normalizedDecisions[i].start}.`);
    }
  }
  const cautions = buildGroundedCautions(videos, duration, availableEnd).slice(0, 50);
  const criticContext = { userIntent: intent, classification: profile.primary, academyGuidance: sectionAcademy };
  const globalReview = await runGlobalEditorialRepair({
    decisions: normalizedDecisions, videos, candidates: allCandidateEditMoments, boundaries: internalBoundaries,
    context: criticContext, maxPasses: 4,
    regenerate: async (region, findings) => {
      const localCandidates = allCandidateEditMoments.filter((item) => number(item.at, NaN) >= region.start && number(item.at, NaN) < region.end);
      const localCatalog = buildEvidenceCatalog(audio, videos, region.start, region.end, localCandidates.map((item) => number(item.at, NaN)));
      const previousClipId = region.current[0].clipId;
      const system = `You are FREEOS's global editorial repair editor. Repair ONLY the supplied region. The deterministic critic identifies problems but never chooses cameras. You choose creative cameras from local measured evidence. Preserve the opening source and the final source at the region boundary. Candidate times are options, not a cadence. Every switch needs local measured evidence for its destination clip when multiple sources are available. Return schema-valid section JSON with switches only.`;
      const packet = buildSectionPacket({ start: region.start, end: region.end, videos,
        availability: videos.map((video) => ({ id: video.id, start: video.timelineAvailableStart, end: video.timelineAvailableEnd })),
        candidates: localCandidates, catalog: localCatalog, intent, brief, profiles: cameraProfiles,
        previousClipId, academy: sectionAcademy, system, numPredict: 2200 });
      const repairContext = { currentTimeline: [...region.before, ...region.current, ...region.after].map((decision) => ({ start: decision.start, end: decision.end, clipId: decision.clipId })),
        region: [region.start, region.end], currentRegion: region.current,
        criticFindings: findings.filter((finding) => finding.start < region.end && finding.end > region.start),
        requiredFinalClipId: region.current.at(-1)!.clipId, projectClassification: profile.primary };
      if (packet.estimatedPromptTokens + estimatePromptTokens(repairContext) > packet.budget.finalInputBudget) throw new Error("context-budget: global repair packet exceeds model context.");
      const repaired = await runBoundedPlanRepair({ maxAttempts: 2,
        generate: async (_attempt, previous) => callModel({ system,
          prompt: { ...packet.packet, editorialRepair: { ...repairContext, ...(previous ? { validationDiagnostic: previous.message.slice(0, 500) } : {}) } },
          schema: packet.schema, timeoutMs: Math.max(config.ollamaGenerateTimeoutMs, 180_000), numPredict: 2200, temperature: 0.15 }),
        validate: (response) => {
          const parsed = parseSectionPlan(String(response));
          const decisions = validateSectionSwitches(parsed.opening, parsed.switches, allowedClipIds,
            region.start, region.end, videos, localCandidates, previousClipId, localCatalog);
          if (region.after.length && decisions.at(-1)?.clipId !== region.current.at(-1)?.clipId) throw new SectionValidationError("continuity", "Global repair must preserve the final source at the region boundary.");
          if (region.start === 0 && decisions[0]?.clipId === region.current[0].clipId) {
            decisions[0].rationale = region.current[0].rationale;
            decisions[0].evidenceRefs = region.current[0].evidenceRefs;
            decisions[0].creativeIntent = region.current[0].creativeIntent;
          }
          return decisions;
        },
        classify: (error) => error instanceof SectionValidationError ? error.category : "structure",
        onFailure: (diagnostic) => {
          telemetry.validationFailures[diagnostic.category] = (telemetry.validationFailures[diagnostic.category] ?? 0) + 1;
          if (diagnostic.category === "target-grounding") telemetry.targetGroundingFailures++;
        },
      });
      return repaired.value;
    },
  });
  telemetry.globalEditorialRepairPasses = globalReview.globalRepairPasses;
  telemetry.criticFindingsBeforeRepair = globalReview.initialCriticFindings.map((finding) => finding.code);
  telemetry.criticFindingsAfterRepair = globalReview.finalCriticFindings.map((finding) => finding.code);
  telemetry.resolvedCriticFindings = globalReview.resolvedFindings.map((finding) => finding.code);
  telemetry.unresolvedMaterialFindings = globalReview.unresolvedMaterialFindings.map((finding) => finding.code);
  telemetry.criticFindings = telemetry.criticFindingsAfterRepair;
  if (globalReview.unresolvedMaterialFindings.length) {
    console.error("[FREEOS Editing Planner] unresolved editorial quality gate", JSON.stringify({
      globalEditorialRepairPasses: telemetry.globalEditorialRepairPasses,
      criticFindingsBeforeRepair: globalReview.initialCriticFindings,
      criticFindingsAfterRepair: globalReview.finalCriticFindings,
      resolvedCriticFindings: globalReview.resolvedFindings,
      unresolvedMaterialFindings: globalReview.unresolvedMaterialFindings,
      errors: globalReview.errors,
    }));
    throw new Error(`Unresolved material editorial findings after ${globalReview.globalRepairPasses} global repair passes: ${JSON.stringify(globalReview.unresolvedMaterialFindings)}; repairErrors=${JSON.stringify(globalReview.errors)}`);
  }
  const finalDecisions = globalReview.decisions;
  const factualSummary = factualEvidenceSummary(finalDecisions);
  const editorialFindings = globalReview.finalCriticFindings;
  const planningTelemetry = { ...telemetry, repairs: Math.max(0, telemetry.sectionAttempts - Math.ceil(availableEnd / sectionSeconds)), finalDecisionCount: finalDecisions.length, totalPlanningMs: Date.now() - startedAt };
  console.log("[FREEOS Editing Planner] telemetry", JSON.stringify({ classification: profile.primary, academyCompetencies: editingKnowledge.gap.relevantCompetencies, ...planningTelemetry }));

  return {
    version: "freeos-creative-planner-v5.6-boundary-prune-review",
    durationSeconds: duration,
    creativeSummary: factualSummary,
    decisions: finalDecisions,
    cautions,
    evidence: {
      audioAnalysisVersion: typeof audio.analysisVersion === "string" ? audio.analysisVersion : undefined,
      videoAnalysisVersions: Object.fromEntries(videos.map((video) => [String(video.id), typeof video.analysisVersion === "string" ? video.analysisVersion : undefined])),
      editingKnowledgeUnits: editingKnowledge.gap.relevantUnits,
      editingKnowledgeGap: editingKnowledge.gap.needsMoreKnowledge,
      plannerMode: "academy-guided-camera-profile-boundary-prune-review",
      cameraProfileCount: cameraProfiles.length,
      assemblyReviewApplied,
      assemblyBoundaryPrunes,
      assemblyReviewFailure,
      projectClassification: { primary: profile.primary, secondary: profile.secondary },
      selectedAcademyCompetencies: editingKnowledge.gap.relevantCompetencies,
      academySelectionReasons: editingKnowledge.gap.selectionReasons,
      initialCriticFindings: globalReview.initialCriticFindings,
      globalRepairPasses: globalReview.globalRepairPasses,
      resolvedFindings: globalReview.resolvedFindings,
      remainingFindings: globalReview.remainingFindings,
      finalCriticFindings: globalReview.finalCriticFindings,
      editorialFindings,
      telemetry: planningTelemetry,
    },
  };
}
