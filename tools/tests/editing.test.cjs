const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSectionSwitches, SectionValidationError } = require('../../apps/api-server/dist/services/editing/validation/section.js');
const { buildEvidenceCatalog, renderEvidenceRationale } = require('../../apps/api-server/dist/services/editing/evidence/evidenceRefs.js');
const { buildCandidateSupportIndex } = require('../../apps/api-server/dist/services/editing/evidence/targetSupport.js');
const { buildSectionPlanSchema } = require('../../apps/api-server/dist/services/editing/planning/schemas.js');
const { parseSectionPlan } = require('../../apps/api-server/dist/services/editing/planning/parsing.js');
const { critiqueTimeline } = require('../../apps/api-server/dist/services/editing/critique/editorialCritic.js');
const { classifyProject } = require('../../apps/api-server/dist/services/editing/classification/projectClassifier.js');
const { resolveEditingIntent } = require('../../apps/api-server/dist/services/editing/classification/projectIntent.js');
const { runBoundedPlanRepair, PlanRepairError } = require('../../apps/api-server/dist/services/editing/repair/planRepair.js');
const { appendSectionDecisions, mergeAdjacentDecisions } = require('../../apps/api-server/dist/services/editing/critique/assembly.js');
const { deterministicOpening } = require('../../apps/api-server/dist/services/editing/planning/openingState.js');
const { buildSectionEditMoments } = require('../../apps/api-server/dist/services/editing/evidence/candidateMoments.js');
const { buildSectionPacket, sectionModelBudget, estimatePromptTokens } = require('../../apps/api-server/dist/services/editing/planning/sectionPacket.js');
const { compactVideo } = require('../../apps/api-server/dist/services/editing/evidence/videoEvidence.js');
const { resolveOpeningEvidenceScope, openingEvidenceByClip } = require('../../apps/api-server/dist/services/editing/evidence/openingEvidence.js');
const { runGlobalEditorialRepair, findRepairRegion, normalizeRegionalSwitches, buildMaterialRepairRegions } = require('../../apps/api-server/dist/services/editing/repair/globalEditorialRepair.js');
const { buildRegionalRepairPacket, resolveRegionalOperations } = require('../../apps/api-server/dist/services/editing/repair/regionalPacket.js');
const { factualEvidenceSummary } = require('../../apps/api-server/dist/services/editing/critique/factualSummary.js');
const { selectEditingAcademyItems } = require('../../apps/api-server/dist/services/editingAcademy.service.js');

test('repeated frame measurements aggregate before section planning', () => {
  const timeline = Array.from({ length: 120 }, (_, i) => ({ time: i / 2, motion: 0.1, sharpness: 0.8, brightness: 0.5, faceCount: 0 }));
  const summarized = compactVideo({ durationSeconds: 60, timeline }, { id: 'a', path: 'synthetic.mp4' });
  assert.equal(summarized.windows.length, 15);
  assert.ok(!summarized.timeline);
});

test('dense five-camera section stays bounded and keeps canonical candidate refs', () => {
  const videos = Array.from({ length: 5 }, (_, i) => video(`cam${i}`, 3600));
  const candidates = Array.from({ length: 32 }, (_, i) => moment(1 + i * 1.7, 8));
  const catalog = [{ id: 'opening', type: 'source-availability', at: 0, clipId: 'cam0' }];
  for (let i = 0; i < 12000; i++) catalog.push({ id: `d${i}`, type: 'motion-shift', at: 600 + i / 10, clipId: `cam${i % 5}`, value: 0.1 });
  for (const c of candidates) for (const v of videos) {
    catalog.push({ id: `m${c.at}-${v.id}`, type: 'motion-shift', at: c.at, clipId: v.id, value: 0.5 });
    for (let i = 0; i < 20; i++) catalog.push({ id: `f${c.at}-${v.id}-${i}`, type: 'face-presence', at: c.at, clipId: v.id, value: 0.5 });
  }
  const make = (records) => buildSectionPacket({ start: 0, end: 60, videos,
    availability: videos.map((v) => ({ id: v.id, start: 0, end: 3600 })),
    candidates, catalog: records, intent: { instruction: 'preserve measured pacing' },
    brief: { creativeSummary: 'Use visual contrast when supported.' }, profiles: [],
    previousClipId: '', academy: 'Use continuity and local evidence.', system: 'Plan one grounded section.', numPredict: 2200 });
  const packet = make(catalog);
  assert.equal(packet.budget.finalInputBudget, 22474);
  assert.ok(packet.estimatedPromptTokens <= packet.budget.finalInputBudget);
  assert.ok(packet.exposedCatalog.length < 600);
  assert.ok(packet.exposedCatalog.some((e) => e.id === 'opening'));
  assert.ok(packet.exposedCatalog.some((e) => e.id === `m${candidates[0].at}-cam0`));
  assert.ok(packet.exposedCatalog.every((e) => catalog.includes(e)));
  assert.ok(!packet.exposedCatalog.some((e) => e.id.startsWith('d')));
  assert.equal(make(catalog.filter((e) => !e.id.startsWith('d'))).estimatedPromptTokens, packet.estimatedPromptTokens);
  assert.ok(estimatePromptTokens(catalog) > packet.estimatedPromptTokens);
  assert(packet.packet.candidateEditMoments.every((item) => Object.values(item.targetSupport).every((refs) => refs.every((ref) => packet.exposedCatalog.some((record) => record.id === ref)))));
});

test('five-camera destination index exposes three unranked local alternatives and validator accepts packet refs', () => {
  const videos = ['a', 'b', 'c', 'd', 'e'].map((id) => video(id, 120));
  const at = 65.125;
  const catalog = [
    { id: 'beat', type: 'audio-transient', at },
    { id: 'a-face', type: 'face-presence', at, clipId: 'a', value: 0.7 },
    { id: 'b-frame', type: 'framing', at, clipId: 'b', label: 'wide' },
    { id: 'c-motion', type: 'camera-motion', at, clipId: 'c', value: 0.2 },
    { id: 'd-old', type: 'scene-change', at: at - 2.075, clipId: 'd' },
    { id: 'e-available', type: 'source-availability', at, clipId: 'e' },
  ];
  const input = { start: 60, end: 120, videos, availability: videos.map((v) => ({ id: v.id, start: 0, end: 120 })),
    candidates: [moment(at)], catalog, intent: {}, brief: {}, profiles: [], previousClipId: 'a', academy: '', system: 'Plan.', numPredict: 2200 };
  const packet = buildSectionPacket(input);
  const candidate = packet.packet.candidateEditMoments[0];
  assert.deepEqual(candidate.availableClips, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(Object.entries(candidate.targetSupport).filter(([, refs]) => refs.length).map(([id]) => id), ['a', 'b', 'c']);
  assert.deepEqual(candidate.timingEvidence, ['beat']);
  assert.equal(candidate.targetSupport.d.length, 0);
  assert.equal(candidate.targetSupport.e.length, 0);
  const variants = packet.schema.properties.switches.items.oneOf;
  assert.deepEqual(variants.map((variant) => variant.properties.clipId.const), ['a', 'b', 'c']);
  for (const id of ['b', 'c']) {
    const refs = ['beat', candidate.targetSupport[id][0]];
    const result = validateSectionSwitches(undefined, [shot(at, id, refs)], new Set(videos.map((v) => v.id)), 60, 120, videos, [moment(at)], 'a', catalog);
    assert.equal(result.at(-1).clipId, id);
  }
  assert.throws(() => validateSectionSwitches(undefined, [shot(at, 'd', ['beat', 'd-old'])], new Set(videos.map((v) => v.id)), 60, 120, videos, [moment(at)], 'a', catalog), /non-local-evidence/);
  assert.throws(() => validateSectionSwitches(undefined, [shot(at, 'e', ['beat'])], new Set(videos.map((v) => v.id)), 60, 120, videos, [moment(at)], 'a', catalog), /target-grounding/);
  const repaired = buildSectionPacket({ ...input, repair: { category: 'target-grounding', message: 'camera d lacks local support', rejected: '{}',
    failedSwitch: { at, clipId: 'd', candidateId: candidate.candidateId, currentClipId: 'a', supportedDestinations: { a: ['a-face'], b: ['b-frame'], c: ['c-motion'] }, holdAllowed: true } } });
  assert.deepEqual(Object.keys(repaired.packet.repair.failedSwitch.supportedDestinations), ['a', 'b', 'c']);
  assert.equal(repaired.packet.repair.failedSwitch.holdAllowed, true);
  assert(!JSON.stringify(repaired.packet.repair.failedSwitch).includes('d-old'));
});

test('audio-only candidate has no destination and holding remains legal', () => {
  const videos = [video('a', 120), video('b', 120)];
  const catalog = [{ id: 'beat', type: 'audio-transient', at: 65 }];
  const support = buildCandidateSupportIndex([moment(65)], catalog, videos)[0];
  assert.deepEqual(support.targetSupport, { a: [], b: [] });
  const packet = buildSectionPacket({ start: 60, end: 120, videos, availability: [], candidates: [moment(65)], catalog,
    intent: {}, brief: {}, profiles: [], previousClipId: 'a', academy: '', system: 'Plan.', numPredict: 2200 });
  assert.equal(packet.packet.candidateEditMoments.length, 0);
  assert.deepEqual(validateSectionSwitches(undefined, [], new Set(['a', 'b']), 60, 120, videos, [moment(65)], 'a', catalog).map((item) => item.clipId), ['a']);
  assert.throws(() => validateSectionSwitches(undefined, [shot(65, 'b', ['beat'])], new Set(['a', 'b']), 60, 120, videos, [moment(65)], 'a', catalog), /target-grounding/);
});

test('evidence compaction keeps target refs for every retained candidate', () => {
  const videos = ['a', 'b', 'c', 'd', 'e'].map((id) => video(id, 120));
  const candidates = Array.from({ length: 32 }, (_, i) => moment(2 + i * 1.5));
  const catalog = candidates.flatMap(({ at }) => [
    { id: `beat-${at}`, type: 'audio-transient', at },
    ...videos.flatMap((v) => [0, 1, 2].map((n) => ({ id: `face-${at}-${v.id}-${n}`, type: 'face-presence', at, clipId: v.id, value: n / 3 }))),
  ]);
  let compact;
  for (const size of [0, 3000, 6000, 9000, 12000]) {
    const packet = buildSectionPacket({ start: 0, end: 60, videos, availability: videos.map((v) => ({ id: v.id, start: 0, end: 120 })),
      candidates, catalog, intent: {}, brief: {}, profiles: [], previousClipId: 'a', academy: '', system: 'x'.repeat(size), numPredict: 2200 });
    if (packet.compactionApplied) { compact = packet; break; }
  }
  assert(compact, 'fixture must trigger compaction');
  assert(compact.packet.candidateEditMoments.length > 0);
  for (const candidate of compact.packet.candidateEditMoments) {
    assert(candidate.timingEvidence.length > 0);
    for (const refs of Object.values(candidate.targetSupport)) assert(refs.some((ref) => compact.exposedCatalog.some((item) => item.id === ref)));
  }
});

test('repeated impossible destination and refs stop bounded repair early', async () => {
  let calls = 0;
  await assert.rejects(runBoundedPlanRepair({ maxAttempts: 4,
    generate: async () => { calls++; return 'same impossible switch'; },
    validate: () => { throw new SectionValidationError('target-grounding', 'unsupported destination'); },
    classify: (error) => error.category,
    failureKey: () => '65:d:beat',
  }), PlanRepairError);
  assert.equal(calls, 2);
});

test('repeated measured samples produce bounded visual state intervals at a cut', () => {
  const timeline = [124, 124.5, 125].map((time) => ({ time, faceCount: 1, framingRole: 'medium', globalMotion: 0.2, sharpness: 0.8, brightness: 0.5 }));
  const measured = compactVideo({ durationSeconds: 130, timeline }, { id: 'b', path: 'b.mp4' });
  for (const type of ['framing', 'face-presence', 'camera-motion', 'sharpness', 'exposure']) {
    const state = measured.stateIntervals.find((item) => item.type === type);
    assert(state && state.timelineStart <= 124.575 && state.timelineEnd > 124.575, type);
  }
  const videos = [video('a', 130), measured];
  const catalog = buildEvidenceCatalog({ transientMoments: [{ time: 124.575, strength: 0.8 }] }, videos, 120, 130, [124.575]);
  const support = buildCandidateSupportIndex([moment(124.575)], catalog, videos)[0];
  assert(support.targetSupport.b.some((id) => catalog.find((record) => record.id === id)?.type === 'face-presence'));
  const face = support.targetSupport.b.find((id) => catalog.find((record) => record.id === id)?.type === 'face-presence');
  assert.equal(validateSectionSwitches(undefined, [shot(124.575, 'b', [face])], new Set(['a', 'b']), 120, 130, videos, [moment(124.575)], 'a', catalog).at(-1).clipId, 'b');
  assert(!support.targetSupport.b.some((id) => catalog.find((record) => record.id === id)?.type === 'scene-change'));
});

test('a sparse sample does not make a four-second summary window local', () => {
  const measured = compactVideo({ durationSeconds: 130, timeline: [
    { time: 124, faceCount: 1, framingRole: 'wide', globalMotion: 0.1 },
    { time: 124.5, faceCount: 0, framingRole: 'close', globalMotion: 0.8 },
  ] }, { id: 'b', path: 'b.mp4' });
  const catalog = buildEvidenceCatalog({}, [video('a', 130), measured], 120, 130, [127.5]);
  assert.deepEqual(buildCandidateSupportIndex([moment(127.5)], catalog, [video('a', 130), measured])[0].targetSupport.b, []);
});

test('context budget failure bypasses creative repair attempts', async () => {
  let calls = 0;
  await assert.rejects(runBoundedPlanRepair({ maxAttempts: 4,
    generate: async () => { calls++; throw Error('Ollama exceed_context_size_error'); },
    validate: () => true,
    classify: (e) => /exceed_context_size_error/.test(String(e)) ? 'context-budget' : 'source-unavailable',
  }), /exceed_context_size_error/);
  assert.equal(calls, 1);
  assert.ok(sectionModelBudget(2200).finalInputBudget < 32768);
});

test('section catalog keeps a 0.8 second boundary halo and excludes distant events', () => {
  const catalog = buildEvidenceCatalog({ transientMoments: [
    { time: 9.4, strength: 0.7 }, { time: 45, strength: 0.8 }, { time: 90, strength: 0.9 },
  ] }, [video('a', 100)], 10, 60, [45]);
  assert.ok(catalog.some((e) => e.type === 'audio-transient' && e.at === 9.4));
  assert.ok(catalog.some((e) => e.type === 'audio-transient' && e.at === 45));
  assert.ok(!catalog.some((e) => e.at === 90));
});

test('one and two camera packets retain intent, availability, and bounded repair context', () => {
  for (const count of [1, 2]) {
    const videos = Array.from({ length: count }, (_, i) => video(`c${i}`, 60));
    const base = { start: 0, end: 60, videos, availability: videos.map((v) => ({ id: v.id, start: 0, end: 60 })),
      candidates: [], catalog: videos.map((v, i) => ({ id: `e${i}`, type: 'source-availability', at: 0, clipId: v.id })),
      intent: { request: 'hold the wide frame where useful' }, brief: {}, profiles: [], previousClipId: 'c0',
      academy: 'Use measured evidence.', system: 'Plan a section.', numPredict: 2200 };
    const first = buildSectionPacket(base);
    const repaired = buildSectionPacket({ ...base, repair: { category: 'continuity', message: 'keep c0 at boundary', rejected: '{"opening":{}}' } });
    assert.deepEqual(first.packet.userIntent, base.intent);
    assert.equal(first.packet.availability.length, count);
    assert.equal(first.packet.previousClipId, 'c0');
    assert.ok(repaired.estimatedPromptTokens <= repaired.budget.finalInputBudget);
    assert.equal(repaired.estimatedPromptTokens, buildSectionPacket({ ...base, repair: { category: 'continuity', message: 'keep c0 at boundary', rejected: '{"opening":{}}' } }).estimatedPromptTokens);
  }
});

const video = (id, end = 40, start = 0, extra = {}) => ({ id, timelineAvailableStart: start, timelineAvailableEnd: end, ...extra });
const opening = (clipId, mode = 'initial-selection') => ({ mode, clipId, action: 'hold', confidence: 0.9, creativeIntent: 'continuity', evidenceRefs: ['opening'] });
const shot = (at, clipId, evidenceRefs) => ({ at, clipId, action: 'cut', confidence: 0.9, creativeIntent: 'visual-contrast', ...(evidenceRefs ? { evidenceRefs } : {}) });
const moment = (at, score = 6) => ({ at, score, reasons: ['measured motion shift'] });
const validate = ({ videos = [video('a'), video('b')], start = 0, end = 20, first = 'a', switches = [], moments = [], previous = '', catalog } = {}) => {
  const refs = catalog ?? [{ id: 'opening', type: 'source-availability', at: start, clipId: first }, ...switches.map((item, index) => ({ id: `switch-${index}`, type: 'face-presence', at: item.at, clipId: item.clipId, value: 0.5 }))];
  const completed = switches.map((item, index) => ({ evidenceRefs: [`switch-${index}`], ...item }));
  return validateSectionSwitches(previous ? undefined : opening(first), completed, new Set(videos.map((v) => v.id)), start, end, videos, moments, previous, refs);
};

test('continuous camera across an internal boundary', () => {
  const result = validate({ start: 10, end: 20, previous: 'a' });
  assert.deepEqual(result.map((item) => item.clipId), ['a']);
});
test('generic 60.999 evidence cannot invalidate a continuation at 60', () => {
  const videos = [video('a', 120), video('b', 120)];
  const refs = [{ id: 'face', type: 'face-presence', at: 60.999, clipId: 'a' }];
  const result = validateSectionSwitches(undefined, [], new Set(['a', 'b']), 60, 120, videos, [], 'a', refs);
  assert.equal(result[0].clipId, 'a');
  assert.equal(result[0].evidenceRefs, undefined);
  assert.match(result[0].rationale, /Continues clip/);
  assert.deepEqual(Object.keys(buildSectionPlanSchema(60, 120, videos, [], refs, 'a').properties), ['switches']);
});
test('first section opening stays evidence grounded and explicitly initial', () => {
  assert.throws(() => validateSectionSwitches({ ...opening('a'), evidenceRefs: [] }, [], new Set(['a']), 0, 60, [video('a', 60)], [], '', []), /missing-evidence-reference/);
  const schema = buildSectionPlanSchema(0, 60, [video('a', 60)], [], [{ id: 'e', type: 'source-availability', at: 0, clipId: 'a' }]);
  assert(schema.required.includes('opening'));
  assert.equal(schema.properties.opening.oneOf[0].properties.mode.const, 'initial-selection');
});
test('first valid framing, face, and motion samples ground initial selection beyond switch locality', () => {
  const raw = { durationSeconds: 60, timeline: [
    { time: 0.882, framingRole: 'wide', faceCount: 1, motion: 0.2, globalMotion: 0.1, sharpness: 0.8, brightness: 0.5 },
    { time: 1.382, framingRole: 'wide', faceCount: 1, motion: 0.3 },
  ] };
  const cameras = ['a', 'b'].map((id) => compactVideo(raw, { id, path: `${id}.mp4` }));
  const scope = resolveOpeningEvidenceScope(cameras);
  assert.equal(scope.start, 0);
  assert(scope.end >= 0.882 && scope.end <= 2);
  const catalog = buildEvidenceCatalog({}, cameras, 0, 60, [], scope);
  for (const id of ['a', 'b']) {
    for (const type of ['framing', 'face-presence', 'motion-state']) {
      const record = catalog.find((item) => item.opening && item.clipId === id && item.type === type);
      assert(record, `${id} missing ${type}`);
      const result = validateSectionSwitches({ ...opening(id), evidenceRefs: [record.id] }, [], new Set(['a', 'b']), 0, 60, cameras, [], '', catalog, scope);
      assert.equal(result[0].clipId, id);
      assert.deepEqual(result[0].evidenceRefs, [record.id]);
    }
  }
  const packet = buildSectionPacket({ start: 0, end: 60, videos: cameras,
    availability: cameras.map((item) => ({ id: item.id, start: 0, end: 60 })), candidates: [], catalog,
    intent: {}, brief: {}, profiles: [], previousClipId: '', academy: '', system: 'Plan.', numPredict: 2200, openingScope: scope });
  assert.equal(packet.packet.openingEvidence.clips.length, 2);
  assert.deepEqual(packet.packet.openingEvidence.clips.map((item) => item.evidenceRefs.length), [7, 7]);
  assert(packet.packet.openingEvidence.clips.every((item) => item.missing.length === 0));
  assert.equal(packet.schema.properties.opening.oneOf.length, 2);
});
test('opening scope remains bounded and cannot justify later creative switches', () => {
  const cameras = [video('a', 60, 0, { openingMeasurements: [{ type: 'face-presence', at: 0.882, value: 1 }], sampleCadence: 0.5 }), video('b', 60)];
  const scope = resolveOpeningEvidenceScope(cameras);
  const catalog = buildEvidenceCatalog({}, cameras, 0, 60, [0, 3], scope);
  const face = catalog.find((item) => item.opening && item.type === 'face-presence');
  assert(face);
  assert.equal(validateSectionSwitches({ ...opening('a'), evidenceRefs: [face.id] }, [], new Set(['a', 'b']), 0, 60, cameras, [], '', catalog, scope)[0].start, 0);
  assert.throws(() => validateSectionSwitches({ ...opening('a'), evidenceRefs: [face.id] }, [shot(0, 'b', [face.id])], new Set(['a', 'b']), 0, 60, cameras, [moment(0)], '', catalog, scope), /non-local-evidence/);
  assert.throws(() => validateSectionSwitches({ ...opening('a'), evidenceRefs: [face.id] }, [shot(3, 'b', [face.id])], new Set(['a', 'b']), 0, 60, cameras, [moment(3)], '', catalog, scope), /non-local-evidence/);
  const outside = { id: 'outside', type: 'face-presence', at: scope.end + 0.01, clipId: 'a', value: 1 };
  assert.throws(() => validateSectionSwitches({ ...opening('a'), evidenceRefs: ['outside'] }, [], new Set(['a', 'b']), 0, 60, cameras, [], '', [...catalog, outside], scope), /non-local-evidence/);
});
test('first positive face presence remains visible when another metric is valid at zero', () => {
  const camera = compactVideo({ durationSeconds: 60, timeline: [
    { time: 0, sharpness: 0.8, faceCount: 0 },
    { time: 0.882, faceCount: 1, motion: 0.2 },
    { time: 1.764, faceCount: 1 },
  ] }, { id: 'a', path: 'a.mp4' });
  const scope = resolveOpeningEvidenceScope([camera]);
  assert(scope.end >= 0.882);
  const catalog = buildEvidenceCatalog({}, [camera], 0, 60, [], scope);
  const positive = catalog.find((item) => item.opening && item.type === 'face-presence' && item.at === 0.882 && item.value === 1);
  assert(positive);
  assert.equal(validateSectionSwitches({ ...opening('a'), evidenceRefs: [positive.id] }, [], new Set(['a']), 0, 60, [camera], [], '', catalog, scope)[0].clipId, 'a');
});
test('unavailable or sparse opening clips are represented without invented measurements', () => {
  const cameras = [video('sparse', 60), video('late', 60, 1)];
  const scope = resolveOpeningEvidenceScope(cameras);
  const catalog = buildEvidenceCatalog({}, cameras, 0, 60, [], scope);
  const states = openingEvidenceByClip(cameras, catalog, scope);
  assert.deepEqual(states.map((item) => item.clipId), ['sparse']);
  assert.equal(states[0].firstMeasurementAt, null);
  assert(states[0].missing.includes('face-presence'));
  assert.throws(() => validateSectionSwitches(opening('late'), [], new Set(['sparse', 'late']), 0, 60, cameras, [], '', catalog, scope), /unavailable/);
});
test('valid opening evidence succeeds on the first bounded repair attempt', async () => {
  const cameras = [video('a', 60, 0, { openingMeasurements: [{ type: 'face-presence', at: 0.882, value: 1 }], sampleCadence: 0.5 })];
  const scope = resolveOpeningEvidenceScope(cameras);
  const catalog = buildEvidenceCatalog({}, cameras, 0, 60, [], scope);
  const face = catalog.find((item) => item.opening && item.type === 'face-presence');
  let calls = 0;
  const repaired = await runBoundedPlanRepair({ maxAttempts: 4,
    generate: async () => { calls++; return { ...opening('a'), evidenceRefs: [face.id] }; },
    validate: (value) => validateSectionSwitches(value, [], new Set(['a']), 0, 60, cameras, [], '', catalog, scope) });
  assert.equal(calls, 1);
  assert.equal(repaired.attempts, 1);
});
test('measured event at exact boundary can produce a grounded creative switch', () => {
  const videos = [video('a', 120), video('b', 120)];
  const events = buildSectionEditMoments({ transientMoments: [{ time: 60, strength: 1 }] }, videos, 60, 120);
  assert(events.some((event) => event.at === 60));
  const refs = [{ id: 'event', type: 'audio-transient', at: 60 }, { id: 'target', type: 'face-presence', at: 60, clipId: 'b', value: 0.5 }];
  const schema = buildSectionPlanSchema(60, 120, videos, [60], refs, 'a');
  assert(schema.properties.switches.items.oneOf.some((variant) => variant.properties.at.enum.includes(60)));
  const result = validateSectionSwitches(undefined, [shot(60, 'b', ['event', 'target'])], new Set(['a', 'b']), 60, 120, videos, [moment(60)], 'a', refs);
  assert.deepEqual(result.map((item) => item.clipId), ['b']);
  assert.equal(result[0].start, 60);
  assert.deepEqual(result[0].evidenceRefs, ['event', 'target']);
  assert.throws(() => validateSectionSwitches(undefined, [shot(60, 'b', ['late'])], new Set(['a', 'b']), 60, 120, videos, [moment(60)], 'a', [{ id: 'late', type: 'face-presence', at: 60.999, clipId: 'b' }]), /non-local-evidence/);
});
test('source ending exactly at boundary uses uniquely legal availability continuation', () => {
  const videos = [video('a', 60), video('b', 120)];
  assert.deepEqual(deterministicOpening('a', videos, 60), { mode: 'availability-transition', clipId: 'b' });
  const result = validateSectionSwitches(undefined, [], new Set(['a', 'b']), 60, 120, videos, [], 'a', []);
  assert.equal(result[0].clipId, 'b');
  assert.match(result[0].rationale, /^Availability repair:/);
  assert.equal(result[0].evidenceRefs, undefined);
});
test('multiple boundary availability alternatives require grounded creative choice', () => {
  const videos = [video('a', 60), video('b', 120), video('c', 120)];
  assert.equal(deterministicOpening('a', videos, 60), undefined);
  const schema = buildSectionPlanSchema(60, 120, videos, [], [], 'a');
  assert(schema.required.includes('opening'));
  assert.throws(() => validateSectionSwitches(undefined, [], new Set(['a', 'b', 'c']), 60, 120, videos, [], 'a', []), /section opening/i);
  const result = validateSectionSwitches({ ...opening('c', 'availability-transition'), evidenceRefs: ['c-available'] }, [], new Set(['a', 'b', 'c']), 60, 120, videos, [], 'a', [{ id: 'c-available', type: 'source-availability', at: 60, clipId: 'c' }]);
  assert.equal(result[0].clipId, 'c');
});
test('boundary cannot itself change an available camera', () => assert.deepEqual(validate({ start: 10, previous: 'a', first: 'b' }).map((item) => item.clipId), ['a']));
test('legal camera change after boundary at a candidate', () => assert.equal(validate({ start: 10, previous: 'a', switches: [shot(12.37, 'b')], moments: [moment(12.37)] })[1].start, 12.37));
test('source ending early gets one legal continuation', () => {
  const result = validate({ videos: [video('a', 6.25), video('b')], end: 12 });
  assert.deepEqual(result.map((item) => item.clipId), ['a', 'b']);
  assert.equal(result[1].start, 6.25);
});
test('multiple legal continuations remain a creative choice', () => assert.throws(() => validate({ videos: [video('a', 6), video('b'), video('c')], end: 12 }), /ambiguous/));
test('no legal continuation returns diagnostics', () => assert.throws(() => validate({ videos: [video('a', 6), video('b', 4)], end: 12 }), /no legal continuation/));
test('A-B-A micro-shot rejected', () => assert.throws(() => validate({ switches: [shot(5, 'b'), shot(5.4, 'a')], moments: [moment(5), moment(5.4)] }), /bounce/));
test('fast return with strong local evidence accepted', () => assert.equal(validate({ switches: [shot(5, 'b'), shot(6, 'a')], moments: [moment(5, 11), moment(6, 11)] }).length, 3));
test('A-B-A-B mechanical alternation rejected', () => assert.throws(() => validate({ switches: [shot(4, 'b'), shot(8, 'a'), shot(12, 'b')], moments: [moment(4), moment(8), moment(12)] }), /alternation/));
test('candidate switch time accepted exactly', () => assert.equal(validate({ switches: [shot(7.123, 'b')], moments: [moment(7.123)] })[1].start, 7.123));
test('non-candidate creative switch rejected', () => assert.throws(() => validate({ switches: [shot(7.2, 'b')], moments: [moment(7.123)] }), /no matching measured candidate/));
test('non-local evidence rejected', () => assert.throws(() => validate({ switches: [shot(7, 'b', ['old'])], moments: [moment(7)], catalog: [{ id: 'opening', type: 'source-availability', at: 0, clipId: 'a' }, { id: 'old', type: 'audio-transient', at: 3 }] }), /non-local-evidence/));
test('free-text rationale cannot bypass references', () => assert.throws(() => validate({ switches: [{ ...shot(7, 'b'), rationale: 'singer enters chorus' }], moments: [moment(7)] }), /unsupported fields/));
test('top-level free-text cannot bypass structured evidence', () => assert.throws(() => parseSectionPlan(JSON.stringify({ opening: opening('a'), switches: [], cautions: ['singer enters chorus'] })), /unsupported free-text fields/));
const evidenceCatalog = [
  { id: 'opening', type: 'source-availability', at: 0, clipId: 'a' },
  { id: 'transient', type: 'audio-transient', at: 7.123, value: 0.8 },
  { id: 'motion', type: 'motion-shift', at: 7.123, clipId: 'b', value: 0.094 },
  { id: 'face', type: 'face-presence', at: 7.123, clipId: 'b', value: 0.72 },
  { id: 'framing', type: 'framing', at: 7.123, clipId: 'b', label: 'wide' },
];
const grounded = (refs, catalog = evidenceCatalog, switchExtra = {}) => validate({ switches: [{ ...shot(7.123, 'b', refs), ...switchExtra }], moments: [moment(7.123)], catalog });
test('valid local transient and target references render public rationale', () => assert.match(grounded(['transient', 'motion'])[1].rationale, /Audio transient at 7\.123s/));
test('invented evidence type cannot be referenced', () => assert.throws(() => grounded(['imaginary']), /invalid-evidence-reference/));
test('evidence timestamp absent from supplied catalog fails', () => assert.throws(() => grounded(['transient'], evidenceCatalog.filter((item) => item.id !== 'transient')), /invalid-evidence-reference/));
test('evidence timestamp outside switch locality fails', () => assert.throws(() => grounded(['old'], [...evidenceCatalog, { id: 'old', type: 'audio-transient', at: 5 }]), /non-local-evidence/));
test('wrong clip evidence reference fails', () => assert.throws(() => grounded(['wrong'], [...evidenceCatalog, { id: 'wrong', type: 'motion-shift', at: 7.123, clipId: 'unknown', value: 0.094 }]), /invalid-evidence-reference|unknown/));
test('structured motion and framing references render measured data', () => assert.match(grounded(['motion', 'framing'])[1].rationale, /motion shift 0\.094.*framing wide/));
test('creative intent cannot substitute for evidence', () => assert.throws(() => grounded([], evidenceCatalog, { creativeIntent: 'rhythmic-response' }), /missing-evidence-reference/));
test('unsupported creative intent fails', () => assert.throws(() => grounded(['transient'], evidenceCatalog, { creativeIntent: 'singing' }), /unsupported-creative-intent/));
test('generic transient, motion, face switch validates without inferred semantics', () => {
  const decision = grounded(['transient', 'motion', 'face'], evidenceCatalog, { creativeIntent: 'rhythmic-response' })[1];
  const rationale = decision.rationale;
  assert.equal(decision.creativeIntent, 'rhythmic-response');
  assert.deepEqual(decision.evidenceRefs, ['transient', 'motion', 'face']);
  assert.match(rationale, /transient.*motion shift.*face presence/i);
  assert.doesNotMatch(rationale, /performer|expression|beat|musical accent|performance/i);
});
test('catalog derives typed references only from measured audio and clip records', () => {
  const catalog = buildEvidenceCatalog(
    { transientMoments: [{ time: 7.123, strength: 0.8 }], windows: [{ start: 4, end: 8, energyMean: 0.3 }] },
    [video('b', 20, 0, { editMoments: [{ time: 7.123, type: 'motion-shift', strength: 0.094 }], windows: [{ timelineStart: 4, timelineEnd: 8, facePresence: 0.72, framingRole: 'wide' }] })],
    0, 20, [7.123]
  );
  assert(catalog.some((item) => item.type === 'audio-transient' && item.at === 7.123));
  assert(catalog.some((item) => item.type === 'motion-shift' && item.clipId === 'b' && item.value === 0.094));
  assert(catalog.some((item) => item.type === 'framing' && item.label === 'wide'));
  assert(catalog.some((item) => item.type === 'face-presence' && item.value === 0.72));
  assert(catalog.every((item) => item.clipId === undefined || item.clipId === 'b'));
});
test('renderer never invents semantic roles or song sections', () => assert.doesNotMatch(renderEvidenceRationale(evidenceCatalog.slice(1)), /performer|singer|audience|lyrics|beat|chorus/i));
test('availability repair keeps system-generated rationale', () => assert.match(validate({ videos: [video('a', 6.25), video('b')], end: 12 })[1].rationale, /^Availability repair:/));
test('intentional end before full audio duration', () => assert.equal(validate({ end: 13.7 })[0].end, 13.7));
for (const count of [1, 2, 5]) test(`${count}-camera project retains legal long hold`, () => assert.equal(validate({ videos: Array.from({ length: count }, (_, i) => video(`v${i}`)), first: 'v0', end: 20 })[0].end, 20));
test('underexposed optional camera remains optional', () => assert.deepEqual(validate({ videos: [video('a'), video('b', 40, 0, { qualityFlags: [{ kind: 'underexposed' }] })] }).map((item) => item.clipId), ['a']));
test('duplicate angle can be ignored', () => assert.deepEqual(validate({ videos: [video('a'), video('b', 40, 0, { visualRole: 'same angle' })] }).map((item) => item.clipId), ['a']));
test('schema enumerates candidate times without synthetic half-second grid', () => {
  const schema = buildSectionPlanSchema(0, 20, [video('a'), video('b')], [7.123], evidenceCatalog);
  const variants = schema.properties.switches.items.oneOf;
  assert(variants.every((item) => item.properties.at.enum.every((at) => at === 7.123)));
  assert(variants.every((item) => item.required.includes('evidenceRefs') && !('rationale' in item.properties)));
});
const decision = (start, end, clipId) => ({ start, end, clipId, action: 'cut', confidence: 0.9, rationale: '' });
test('section merge removes artificial boundary', () => {
  const pieces = [decision(0, 10, 'a'), decision(10, 20, 'a')];
  const merged = mergeAdjacentDecisions(pieces);
  assert.deepEqual(merged, [decision(0, 20, 'a')]);
});
test('assembly removes 60, 120, and 180 boundaries during a long hold with 1, 2, and 5 cameras', () => {
  for (const count of [1, 2, 5]) {
    const videos = Array.from({ length: count }, (_, index) => video(index === 0 ? 'a' : `extra-${index}`, 240));
    const assembled = [];
    for (const start of [0, 60, 120, 180]) {
      const section = start === 0
        ? validate({ videos, start, end: start + 60 })
        : validate({ videos, start, end: start + 60, previous: 'a' });
      appendSectionDecisions(assembled, section);
    }
    assert.deepEqual(assembled.map((item) => [item.start, item.end, item.clipId]), [[0, 240, 'a']]);
  }
});
test('assembly keeps a real creative switch exactly at the section boundary', () => {
  const videos = [video('a', 120), video('b', 120)];
  const assembled = validate({ videos, start: 0, end: 60 });
  const next = validateSectionSwitches(undefined, [shot(60, 'b', ['event', 'target'])], new Set(['a', 'b']), 60, 120, videos, [moment(60)], 'a', [{ id: 'event', type: 'audio-transient', at: 60 }, { id: 'target', type: 'face-presence', at: 60, clipId: 'b', value: 0.5 }]);
  appendSectionDecisions(assembled, next);
  assert.deepEqual(assembled.map((item) => [item.start, item.clipId]), [[0, 'a'], [60, 'b']]);
});
test('assembly preserves creative switches while removing computational boundaries', () => {
  const videos = [video('a', 180), video('b', 180), video('c', 180)];
  const assembled = [];
  appendSectionDecisions(assembled, validate({ videos, start: 0, end: 60, switches: [shot(35, 'b')], moments: [moment(35)] }));
  appendSectionDecisions(assembled, validate({ videos, start: 60, end: 120, previous: 'b', switches: [shot(74, 'c')], moments: [moment(74)] }));
  appendSectionDecisions(assembled, validate({ videos, start: 120, end: 180, previous: 'c' }));
  assert.deepEqual(assembled.map((item) => [item.start, item.clipId]), [[0, 'a'], [35, 'b'], [74, 'c']]);
  assert.equal(assembled.at(-1).end, 180);
});
test('deterministic opening failure does not consume creative repair attempts', async () => {
  let calls = 0;
  await assert.rejects(runBoundedPlanRepair({ maxAttempts: 4,
    generate: async () => { calls++; return {}; },
    validate: () => { throw new SectionValidationError('opening-state', 'invalid system state'); },
    classify: (error) => error.category,
  }), /invalid system state/);
  assert.equal(calls, 1);
});
test('critic finds fixed cadence without dictating a replacement', () => {
  const items = Array.from({ length: 6 }, (_, i) => decision(i * 4, (i + 1) * 4, i % 2 ? 'b' : 'a'));
  const findings = critiqueTimeline(items, [video('a'), video('b')]);
  assert(findings.some((item) => item.code === 'fixed-cadence'));
  assert(findings.some((item) => item.code === 'mechanical-alternation'));
  assert(findings.every((item) => !('replacementClipId' in item)));
});
test('critic reports boundary artifact and missed opportunities', () => {
  const findings = critiqueTimeline([decision(0, 10, 'a'), decision(10, 35, 'b')], [video('a'), video('b')], [], [10]);
  assert(findings.some((item) => item.code === 'boundary-artifact'));
  assert(critiqueTimeline([decision(0, 35, 'a')], [video('a'), video('b')], [moment(5, 11), moment(10, 11), moment(15, 11)]).some((item) => item.code === 'missed-opportunities'));
});
test('classifier selects relevant edit class from user intent', () => assert.equal(classifyProject({ audioPath: '', clips: [], userIntent: 'Documentary interview' }, [video('a')], {}).primary, 'interview'));
test('owner taste and project intent remain separately scoped', () => {
  const layers = resolveEditingIntent({ audioPath: '', clips: [], userIntent: 'End at the speech', ownerPreferences: ['Prefer restrained pacing'] });
  assert.equal(layers.projectIntent, 'End at the speech');
  assert.deepEqual(layers.ownerPreferences, ['Prefer restrained pacing']);
  assert(layers.universalPrinciples.every((rule) => !rule.includes('speech')));
});
test('bounded repair returns structured failures', async () => {
  await assert.rejects(runBoundedPlanRepair({ maxAttempts: 2, generate: async () => ({}), validate: () => { throw Error('invalid timing'); } }), (error) => error instanceof PlanRepairError && error.diagnostics.length === 2);
});
test('bounded repair passes precise prior failure into retry', async () => {
  const seen = [];
  const result = await runBoundedPlanRepair({
    maxAttempts: 3,
    generate: async (attempt, previous) => { seen.push(previous?.message); return { valid: attempt === 2 }; },
    validate: (value) => { if (!value.valid) throw Error('candidate at 7.2 is absent'); return value; },
  });
  assert.equal(result.attempts, 2);
  assert.deepEqual(seen, [undefined, 'candidate at 7.2 is absent']);
});

test('destination grounding separates timing, target visual support, and comparison support', () => {
  const cameras = [video('a'), video('b'), video('c')];
  const records = [
    { id: 'audio', type: 'audio-transient', at: 7 },
    { id: 'other', type: 'face-presence', at: 7, clipId: 'a', value: 0.6 },
    { id: 'target', type: 'framing', at: 7, clipId: 'b', label: 'wide' },
  ];
  const check = (refs) => validateSectionSwitches(undefined, [shot(7, 'b', refs)], new Set(['a', 'b', 'c']), 0, 20, cameras, [moment(7)], 'a', records);
  assert.throws(() => check(['audio']), /target-grounding/);
  assert.throws(() => check(['audio', 'other']), /target-grounding/);
  assert.equal(check(['audio', 'target'])[1].clipId, 'b');
  assert.equal(check(['audio', 'target', 'other'])[1].clipId, 'b');
});

test('single-source candidate handoff accepts local availability evidence', () => {
  const cameras = [video('a', 6), video('b', 20, 6)];
  const result = validateSectionSwitches(undefined, [shot(6, 'b', ['available'])], new Set(['a', 'b']), 0, 20, cameras, [moment(6)], 'a', [{ id: 'available', type: 'source-availability', at: 6, clipId: 'b' }]);
  assert.equal(result[1].clipId, 'b');
});

test('intent-aware critic escalates supported long holds and leaves contemplative holds informational', () => {
  const draft = [decision(0, 50, 'a'), decision(50, 80, 'b')];
  const opportunities = [10, 20, 30, 40, 60].map((at) => moment(at, 11));
  const energetic = critiqueTimeline(draft, [video('a', 80), video('b', 80)], opportunities, [], { userIntent: 'substantially more cuts and visual energy', classification: 'performance' });
  const quiet = critiqueTimeline(draft, [video('a', 80), video('b', 80)], opportunities, [], { userIntent: 'slow contemplative interview', classification: 'interview' });
  assert(energetic.some((finding) => finding.code === 'long-stretch' && finding.severity === 'material'));
  assert(quiet.every((finding) => finding.code !== 'long-stretch' || finding.severity === 'info'));
  assert(energetic.every((finding) => !/replace|choose camera/i.test(finding.evidence)));
  const alternating = [decision(0, 4, 'a'), decision(4, 8, 'b'), decision(8, 12, 'a'), decision(12, 16, 'b')];
  assert(critiqueTimeline(alternating, [video('a'), video('b')]).some((finding) => finding.code === 'mechanical-alternation' && finding.severity === 'material'));
});

test('global editorial repair is triggered only by material findings, bounded, revalidated, and re-criticized', async () => {
  const sources = [video('a', 80), video('b', 80)];
  const candidates = [10, 20, 30, 40].map((at) => moment(at, 11));
  const draft = [decision(0, 50, 'a'), decision(50, 80, 'b')];
  let calls = 0;
  const options = { decisions: draft, videos: sources, candidates, boundaries: [], maxPasses: 1,
    regenerate: async (region) => { calls++; return [decision(region.start, 20, 'a'), decision(20, 30, 'b'), decision(30, region.end, 'a')]; } };
  const energetic = await runGlobalEditorialRepair({ ...options, context: { userIntent: 'substantially more cuts and visual energy' } });
  assert.equal(calls, 1);
  assert.equal(energetic.globalRepairPasses, 1);
  assert(energetic.finalCriticFindings.length >= 0);
  assert(energetic.decisions.length > draft.length);
  calls = 0;
  const quiet = await runGlobalEditorialRepair({ ...options, context: { userIntent: 'slow contemplative interview' } });
  assert.equal(calls, 0);
  assert.equal(quiet.globalRepairPasses, 0);
  const invalid = await runGlobalEditorialRepair({ ...options, context: { userIntent: 'substantially more cuts and visual energy' }, regenerate: async () => [decision(0, 90, 'b')] });
  assert.equal(invalid.globalRepairPasses, 0);
  assert(invalid.unresolvedMaterialFindings.length > 0);
  assert(invalid.errors.length > 0);
  assert.equal(invalid.globalRepairAppliedPasses, 0);
  assert.deepEqual(invalid.decisions, draft);
});

test('regional opening state is inherited, and a same-clip boundary point is removed', () => {
  const timeline = [decision(0, 10, 'a'), decision(10, 40, 'b'), decision(40, 60, 'a')];
  const region = findRepairRegion(timeline, { code: 'long-stretch', severity: 'material', start: 12, end: 35, evidence: '' });
  assert.equal(region.start, 10);
  assert.equal(region.openingClipId, 'b');
  assert.equal(region.priorDecision.clipId, 'a');
  assert.equal(region.nextDecision.clipId, 'a');
  const normalized = normalizeRegionalSwitches([shot(10, 'b', ['irrelevant']), shot(20, 'a', ['target'])], region.start, region.openingClipId);
  assert.equal(normalized.boundaryNoOpsRemoved, 1);
  assert.deepEqual(normalized.switches.map((item) => item.at), [20]);
  assert.equal(normalizeRegionalSwitches([shot(10, 'a', ['target'])], region.start, region.openingClipId).switches.length, 1);
});

test('regional packet offers only canonical supported targets and its refs validate', () => {
  const videos = [video('a', 60), video('b', 60), video('c', 60)];
  const catalog = [{ id: 'timing', type: 'audio-transient', at: 20 },
    { id: 'supported', type: 'framing', at: 20, clipId: 'c', label: 'wide' },
    { id: 'distant', type: 'framing', at: 18, clipId: 'b', label: 'wide' }];
  const packet = buildSectionPacket({ start: 10, end: 40, videos, availability: videos.map((item) => ({ id: item.id, start: 0, end: 60 })),
    candidates: [moment(20)], catalog, intent: {}, brief: {}, profiles: [], previousClipId: 'a', academy: '', system: 'Repair.', numPredict: 1000 });
  const support = packet.supportIndex[0].targetSupport;
  assert.deepEqual(support.c, ['supported']);
  assert.deepEqual(support.b, []);
  const variants = packet.schema.properties.switches.items.oneOf;
  assert(variants.some((item) => item.properties.clipId.const === 'c'));
  assert(!variants.some((item) => item.properties.clipId.const === 'b'));
  const repaired = validateSectionSwitches(undefined, [shot(20, 'c', ['timing', ...support.c])],
    new Set(['a', 'b', 'c']), 10, 40, videos, [moment(20)], 'a', packet.exposedCatalog);
  assert.equal(repaired[1].clipId, 'c');
  assert.throws(() => validateSectionSwitches(undefined, [shot(20, 'b', ['timing', 'distant'])],
    new Set(['a', 'b', 'c']), 10, 40, videos, [moment(20)], 'a', catalog), /target-grounding|local/);
});

test('dense global repair packet is bounded, distributed, and resolves only canonical local support', () => {
  const videos = ['a', 'b', 'c', 'd', 'e'].map((id) => video(id, 80));
  const draft = [decision(0, 10, 'a'), decision(10, 30, 'b'), decision(30, 60, 'a'), decision(60, 80, 'b')];
  const region = findRepairRegion(draft, { code: 'long-stretch', severity: 'material', start: 12, end: 55, evidence: 'supported alternate views' });
  const candidates = Array.from({ length: 160 }, (_, i) => moment(10.2 + i * .31, 8 + i % 7));
  const catalog = [];
  for (const [index, candidate] of candidates.entries()) {
    catalog.push({ id: `beat${index}`, type: 'audio-transient', at: candidate.at });
    for (const source of videos) for (let j = 0; j < 4; j++) catalog.push({ id: `visual${index}-${source.id}-${j}`, type: j ? 'face-presence' : 'framing', at: candidate.at, clipId: source.id, label: 'wide', value: .5 });
  }
  catalog.push({ id: 'distant', type: 'scene-change', at: 70, clipId: 'c' });
  const input = { region, findings: [region.finding], candidates, catalog, videos, intent: 'more visual energy', classification: 'performance', academy: 'Use measured contrast.'.repeat(250), system: 'Repair the region.', numPredict: 2200 };
  const packet = buildRegionalRepairPacket(input);
  assert(estimatePromptTokens(catalog) > packet.budget.finalInputBudget);
  assert(packet.estimated <= packet.budget.finalInputBudget);
  assert(packet.telemetry.globalRepairCompactionApplied);
  assert(packet.telemetry.exposedRegionalCandidateCount < candidates.length);
  assert(packet.candidates.some((item) => item.at < 20));
  assert(packet.candidates.some((item) => item.at > 50));
  assert(new Set(packet.candidates.slice(1).map((item, i) => (item.at - packet.candidates[i].at).toFixed(2))).size > 1);
  assert.equal(packet.packet.openingClipId, 'b');
  assert.equal(packet.packet.exitClipBeforeRepair, 'a');
  assert.equal(packet.packet.current.length, region.current.length);
  assert.equal(packet.packet.findings[0].code, 'long-stretch');
  assert(packet.packet.switches.some((item) => item.id === 's0'));
  const selected = packet.candidates.find((item) => item.targetSupport.c?.length);
  const switchRows = resolveRegionalOperations({ operations: [{ operation: 'add-switch', candidateId: selected.candidateId, destinationClipId: 'c', creativeIntent: 'visual-contrast' }] }, packet, region);
  const added = switchRows.find((item) => item.at === selected.at && item.clipId === 'c');
  assert(added);
  assert(added.evidenceRefs.some((id) => id.startsWith('visual')));
  assert(!added.evidenceRefs.includes('distant'));
  assert.throws(() => resolveRegionalOperations({ operations: [{ operation: 'add-switch', candidateId: selected.candidateId, destinationClipId: 'z', creativeIntent: 'visual-contrast' }] }, packet, region), /target-grounding/);
  assert.throws(() => resolveRegionalOperations({ operations: [{ operation: 'add-switch', candidateId: selected.candidateId, destinationClipId: 'c', at: 99, creativeIntent: 'visual-contrast' }] }, packet, region), /unsupported fields/);
  assert.throws(() => resolveRegionalOperations({ operations: [{ operation: 'add-switch', existingSwitchId: 's0', candidateId: selected.candidateId, destinationClipId: 'c', creativeIntent: 'visual-contrast' }] }, packet, region), /Add-switch cannot/);
  const validated = validateSectionSwitches(undefined, [added], new Set(videos.map((item) => item.id)), region.start, region.end, videos, candidates, region.openingClipId, catalog);
  assert(validated.some((item) => item.start === selected.at && item.clipId === 'c'));
  assert.throws(() => buildRegionalRepairPacket({ ...input, intent: 'x'.repeat(100000) }), /global-repair-context-budget/);
});

test('global repair context overflow is reported before any model attempt', async () => {
  const videos = [video('a', 80), video('b', 80)];
  const draft = [decision(0, 50, 'a'), decision(50, 80, 'b')];
  const candidates = [10, 20, 30, 40].map((at) => moment(at, 11));
  const catalog = candidates.map((candidate) => ({ id: `b${candidate.at}`, type: 'framing', at: candidate.at, clipId: 'b', label: 'wide' }));
  let modelAttempts = 0;
  const result = await runGlobalEditorialRepair({ decisions: draft, videos, candidates, boundaries: [],
    context: { userIntent: 'substantially more cuts and visual energy', candidateSupport: candidates.map((candidate) => ({ at: candidate.at, targetSupport: { b: [`b${candidate.at}`] } })) }, maxPasses: 1,
    regenerate: async (region, findings, pass, reportModelAttempt) => {
      buildRegionalRepairPacket({ region, findings, candidates, catalog, videos, intent: 'x'.repeat(100000), classification: 'performance', academy: '', system: 'Repair.', numPredict: 2200 });
      reportModelAttempt(); modelAttempts++;
      return region.current;
    } });
  assert.equal(modelAttempts, 0);
  assert.equal(result.globalRepairModelAttempts, 0);
  assert.equal(result.globalRepairValidationFailures, 0);
  assert.equal(result.infrastructureFailures.length, 1);
  assert.equal(result.editorialLimitations.length, 0);
});

test('existing switches remain removable when no alternate destinations are supported', async () => {
  const videos = [video('a', 40), video('b', 40)];
  const decisions = [decision(0, 4, 'a'), decision(4, 8, 'b'), decision(8, 12, 'a'), decision(12, 16, 'b')];
  const candidates = [4, 8, 12].map((at) => moment(at, 11));
  let calls = 0;
  const result = await runGlobalEditorialRepair({ decisions, videos, candidates, boundaries: [], maxPasses: 1,
    context: { userIntent: 'avoid mechanical alternation', candidateSupport: [] },
    regenerate: async () => { calls++; return decisions; } });
  assert.equal(calls, 1);
  assert(result.editorialLimitations.length > 0);
  assert.equal(result.infrastructureFailures.length, 0);
  assert(result.unresolvedMaterialFindings.length > 0);
});

test('global repair operation IDs cover hold, remove, replace, and move', () => {
  const videos = ['a', 'b', 'c'].map((id) => video(id, 50));
  const draft = [decision(0, 10, 'a'), decision(10, 20, 'b'), decision(20, 30, 'a')];
  const region = findRepairRegion(draft, { code: 'mechanical-alternation', severity: 'material', start: 10, end: 29, evidence: '' });
  const candidates = [moment(12), moment(15), moment(20), moment(25)];
  const catalog = candidates.flatMap((candidate) => videos.map((source) => ({ id: `${candidate.at}-${source.id}`, type: 'framing', at: candidate.at, clipId: source.id, label: 'wide' })));
  const packet = buildRegionalRepairPacket({ region, findings: [region.finding], candidates, catalog, videos, intent: 'vary shots', classification: 'performance', academy: '', system: 'Repair.', numPredict: 2200 });
  assert.equal(resolveRegionalOperations({ operations: [{ operation: 'hold' }] }, packet, region).length, region.current.length - 1);
  assert.equal(resolveRegionalOperations({ operations: [{ operation: 'remove-switch', existingSwitchId: 's0' }] }, packet, region).length, region.current.length - 2);
  const c15 = packet.candidates.find((item) => item.at === 15);
  const replace = resolveRegionalOperations({ operations: [{ operation: 'replace-destination', existingSwitchId: 's0', candidateId: c15.candidateId, destinationClipId: 'c', creativeIntent: 'visual-contrast' }] }, packet, region);
  assert(replace.some((item) => item.at === 15 && item.clipId === 'c'));
  const moved = resolveRegionalOperations({ operations: [{ operation: 'move-switch', existingSwitchId: 's0', candidateId: c15.candidateId, destinationClipId: 'c', creativeIntent: 'visual-contrast' }] }, packet, region);
  assert(moved.some((item) => item.at === 15 && item.clipId === 'c'));
  assert(!moved.some((item) => item.at === 20));
});

test('critic counts supported alternate destinations rather than raw transients', () => {
  const draft = [decision(0, 50, 'a'), decision(50, 80, 'b')];
  const candidates = [10, 20, 30, 40].map((at) => moment(at, 11));
  const context = { userIntent: 'substantially more cuts and visual energy', candidateSupport: candidates.map((candidate) =>
    ({ at: candidate.at, targetSupport: { a: ['a-ref'], b: [] } })) };
  const findings = critiqueTimeline(draft, [video('a', 80), video('b', 80)], candidates, [], context);
  assert(!findings.some((item) => item.code === 'long-stretch' && item.severity === 'material'));
  assert(findings.some((item) => item.code === 'long-stretch' && /rawCandidateCount=4; viableCandidateCount=0/.test(item.evidence)));
});

test('regional edits can remove, replace, and move switches while preserving outside and exit continuity', async () => {
  const sources = [video('a', 40), video('b', 40), video('c', 40)];
  const draft = [decision(0, 4, 'a'), decision(4, 8, 'b'), decision(8, 12, 'a'), decision(12, 16, 'b'), decision(16, 24, 'c')];
  const base = { decisions: draft, videos: sources, candidates: [], boundaries: [], context: {}, maxPasses: 1 };
  const proposals = [
    [decision(0, 8, 'a'), decision(8, 16, 'b')],
    [decision(0, 4, 'a'), decision(4, 8, 'b'), decision(8, 12, 'c'), decision(12, 16, 'b')],
    [decision(0, 6, 'a'), decision(6, 16, 'b')],
  ];
  for (const proposal of proposals) {
    const result = await runGlobalEditorialRepair({ ...base, regenerate: async (region) => {
      assert.equal(region.start, 0);
      assert.equal(region.end, 16);
      assert.equal(region.nextDecision.clipId, 'c');
      return proposal;
    } });
    assert.equal(result.globalRepairAppliedPasses, 1);
    assert.deepEqual(result.decisions.slice(0, -1), proposal);
    assert.deepEqual(result.decisions.at(-1), draft.at(-1));
  }
  const exitNoOp = await runGlobalEditorialRepair({ ...base, regenerate: async () => [decision(0, 16, 'c')] });
  assert.equal(exitNoOp.globalRepairAppliedPasses, 1);
  assert.equal(exitNoOp.decisions.length, 1);
  assert.equal(exitNoOp.decisions[0].end, 24);
});

test('overlapping material findings share a bounded regional request', async () => {
  const draft = [decision(0, 20, 'a'), decision(20, 40, 'b'), decision(40, 60, 'a'), decision(60, 80, 'b'), decision(80, 100, 'c')];
  const candidates = Array.from({ length: 19 }, (_, index) => moment((index + 1) * 5, 11));
  const result = await runGlobalEditorialRepair({ decisions: draft, videos: ['a', 'b', 'c'].map((id) => video(id, 100)),
    candidates, boundaries: [], context: { userIntent: 'substantially more cuts and visual energy' }, maxPasses: 1,
    regenerate: async (region) => region.current });
  assert(result.regionLogs.length >= 1 && result.regionLogs.length <= 3);
  assert(result.regionLogs.every((region) => region.regionEnd - region.regionStart <= 75 && region.repairApplied === false));
});

test('successful repair re-critiques the accepted timeline before choosing another region', async () => {
  const draft = [decision(0, 4, 'a'), decision(4, 8, 'b'), decision(8, 12, 'a'), decision(12, 16, 'b')];
  const result = await runGlobalEditorialRepair({ decisions: draft, videos: [video('a', 20), video('b', 20)],
    candidates: [], boundaries: [], context: {}, maxPasses: 4,
    regenerate: async (region) => [decision(region.start, region.end, 'a')] });
  assert.equal(result.globalRepairAppliedPasses, 1);
  assert.equal(result.globalRepairCritiquePasses, 1);
  assert.equal(result.regionLogs.length, 1);
  assert.equal(result.unresolvedMaterialFindings.length, 0);
});

test('factual summary ignores creative prose and reflects validated scene changes', () => {
  const shots = [decision(0, 5, 'a'), { ...decision(5, 10, 'b'), rationale: 'Clip b has a measured scene change at 5.000s.' }];
  const summary = factualEvidenceSummary(shots);
  assert.match(summary, /1 switches cite measured scene-change evidence/);
  assert.doesNotMatch(summary, /chord|gesture|facial expression|no scene.change/i);
});

test('canonical evidence IDs survive regional reconstruction and subset compaction', () => {
  const sources = [video('a', 60), video('b', 60)];
  const audio = { transientMoments: [{ time: 10, strength: .8 }, { time: 20, strength: .8 }] };
  const full = buildEvidenceCatalog(audio, sources, 0, 60, [10, 20]);
  const regional = buildEvidenceCatalog(audio, sources, 10, 30, [20]);
  for (const record of regional) {
    const canonical = full.find((item) => item.id === record.id);
    assert(canonical);
    assert.deepEqual(canonical, record);
  }
  const draft = [decision(0, 10, 'a'), decision(10, 60, 'a')];
  const region = findRepairRegion(draft, { code: 'long-stretch', severity: 'material', start: 12, end: 50, evidence: '' });
  const catalog = [{ id: 'e1', type: 'audio-transient', at: 10 }, { id: 'e2', type: 'framing', at: 10, clipId: 'a', label: 'wide' }, { id: 'e3', type: 'framing', at: 20, clipId: 'b', label: 'wide' }];
  const packet = buildRegionalRepairPacket({ region, findings: [], candidates: [moment(20)], catalog, videos: sources, intent: '', classification: '', academy: '', system: '', numPredict: 2200 });
  const rows = resolveRegionalOperations({ operations: [{ operation: 'add-switch', candidateId: packet.candidates[0].candidateId, destinationClipId: 'b', creativeIntent: 'visual-contrast' }] }, packet, region);
  assert(rows.some((row) => row.evidenceRefs.includes('e3')));
  assert.throws(() => resolveRegionalOperations({ operations: [{ operation: 'add-switch', candidateId: packet.candidates[0].candidateId, destinationClipId: 'b', creativeIntent: 'visual-contrast', evidenceRefs: ['e1'] }] }, packet, region), /unsupported fields/);
  assert.throws(() => resolveRegionalOperations({ operations: [{ operation: 'add-switch', candidateId: packet.candidates[0].candidateId, destinationClipId: 'b', creativeIntent: 'visual-contrast', at: 20 }] }, packet, region), /unsupported fields/);
});

test('global repair no-op does not consume applied pass or re-critique', async () => {
  const draft = [decision(0, 50, 'a'), decision(50, 80, 'b')];
  const result = await runGlobalEditorialRepair({ decisions: draft, videos: [video('a', 80), video('b', 80)], candidates: [10, 20, 30, 40].map((at) => moment(at, 11)), boundaries: [], context: { userIntent: 'substantially more cuts and visual energy' }, maxPasses: 1, regenerate: async (region) => region.current.map((item) => ({ ...item, rationale: 'metadata only' })) });
  assert.equal(result.globalRepairAppliedPasses, 0);
  assert.equal(result.globalRepairPasses, 0);
  assert.equal(result.globalRepairNoOpProposals, 1);
  assert.equal(result.globalRepairCritiquePasses, 0);
  assert.equal(result.regionLogs[0].repairApplied, false);
});

test('infrastructure failure in one material region does not starve another', async () => {
  const draft = [decision(0, 50, 'a'), decision(50, 100, 'b'), decision(100, 150, 'a')];
  const candidates = [10, 20, 30, 40, 60, 70, 80, 90, 110, 120, 130, 140].map((at) => moment(at, 11));
  const starts = [];
  const result = await runGlobalEditorialRepair({ decisions: draft, videos: [video('a', 150), video('b', 150)], candidates, boundaries: [], context: { userIntent: 'substantially more cuts and visual energy' }, maxPasses: 1,
    regenerate: async (region) => { starts.push(region.start); if (starts.length === 1) throw new Error('invalid-evidence-reference: synthetic infrastructure failure'); return region.current; } });
  assert(starts.length >= 2);
  assert.notEqual(starts[0], starts[1]);
  assert.equal(result.globalRepairAppliedPasses, 0);
  assert.equal(result.infrastructureFailures.length, 1);
});

test('material region grouping joins nearby alternation findings without swallowing a long hold', () => {
  const draft = [decision(0, 20, 'a'), decision(20, 40, 'b'), decision(40, 60, 'a'), decision(60, 80, 'b'), decision(80, 200, 'a')];
  const findings = [
    { code: 'mechanical-alternation', severity: 'material', start: 20, end: 50, evidence: '' },
    { code: 'mechanical-alternation', severity: 'material', start: 40, end: 70, evidence: '' },
    { code: 'long-stretch', severity: 'material', start: 65, end: 190, evidence: '' },
  ];
  const regions = buildMaterialRepairRegions(draft, findings);
  assert.equal(regions.length, 2);
  assert.equal(regions[0].members.length, 2);
});

test('editing plan route returns structured quality gate 422 and unexpected 500', async () => {
  const express = require('express');
  const service = require('../../apps/api-server/dist/services/editingPlanner.service.js');
  const { editingPlannerRouter } = require('../../apps/api-server/dist/routes/editingPlanner.routes.js');
  const original = service.buildCreativeEditPlan;
  const app = express();
  app.use(express.json());
  app.use('/editing', editingPlannerRouter);
  app.use((_error, _request, response, _next) => response.status(500).json({ error: 'unexpected' }));
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/editing/plan`;
    const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audioPath: 'audio.wav', clips: [] }) });
    service.buildCreativeEditPlan = async () => { throw new service.EditorialQualityGateError({ unresolvedMaterialFindings: [{ code: 'long-stretch' }], repairInfrastructureFailures: ['invalid-evidence-reference'], editorialLimitations: [], telemetry: { globalRepairAppliedPasses: 0 } }); };
    const domain = await post();
    assert.equal(domain.status, 422);
    assert.equal((await domain.json()).error, 'editorial-quality-gate');
    service.buildCreativeEditPlan = async () => { throw new Error('unexpected'); };
    const internal = await post();
    assert.equal(internal.status, 500);
  } finally {
    service.buildCreativeEditPlan = original;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Academy selection favors performance editing and excludes unrelated engine structure', () => {
  const unit = (id, key, title, relevance) => ({ id, competencyKey: key, competencyName: title, title, content: title, relevance });
  const selected = selectEditingAcademyItems([
    unit(1, 'unity-scenes-addressables', 'Unity scenes and addressables', 30),
    unit(2, 'performance-multicam', 'Performance multicam editing', 12),
    unit(3, 'rhythmic-editing', 'Rhythmic editing', 11),
    unit(4, 'continuity-motivated-cuts', 'Continuity motivated cuts', 10),
  ], 'performance editing more cuts visual energy', 4);
  assert.deepEqual(selected.items.map((item) => item.id), [2, 3, 4]);
  assert.equal(selected.reasons.length, 3);
  const crossDomain = selectEditingAcademyItems([unit(1, 'unity-scenes-addressables', 'Unity scenes and addressables', 30)], 'edit a Unity scene project', 4);
  assert.deepEqual(crossDomain.items.map((item) => item.id), [1]);
});
