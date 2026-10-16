const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSectionSwitches, SectionValidationError } = require('../../apps/api-server/dist/services/editing/validation/section.js');
const { buildEvidenceCatalog, renderEvidenceRationale } = require('../../apps/api-server/dist/services/editing/evidence/evidenceRefs.js');
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
const { runGlobalEditorialRepair } = require('../../apps/api-server/dist/services/editing/repair/globalEditorialRepair.js');
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
  assert.equal(invalid.globalRepairPasses, 1);
  assert(invalid.unresolvedMaterialFindings.length > 0);
  assert(invalid.errors.length > 0);
});

test('factual summary ignores creative prose and reflects validated scene changes', () => {
  const shots = [decision(0, 5, 'a'), { ...decision(5, 10, 'b'), rationale: 'Clip b has a measured scene change at 5.000s.' }];
  const summary = factualEvidenceSummary(shots);
  assert.match(summary, /1 switches cite measured scene-change evidence/);
  assert.doesNotMatch(summary, /chord|gesture|facial expression|no scene.change/i);
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
