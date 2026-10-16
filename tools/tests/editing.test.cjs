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
  const refs = catalog ?? [{ id: 'opening', type: 'source-availability', at: start, clipId: first }, ...switches.map((item, index) => ({ id: `switch-${index}`, type: 'source-availability', at: item.at, clipId: item.clipId }))];
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
test('measured event at exact boundary can produce a grounded creative switch', () => {
  const videos = [video('a', 120), video('b', 120)];
  const events = buildSectionEditMoments({ transientMoments: [{ time: 60, strength: 1 }] }, videos, 60, 120);
  assert(events.some((event) => event.at === 60));
  const refs = [{ id: 'event', type: 'audio-transient', at: 60 }];
  const schema = buildSectionPlanSchema(60, 120, videos, [60], refs, 'a');
  assert(schema.properties.switches.items.oneOf.some((variant) => variant.properties.at.enum.includes(60)));
  const result = validateSectionSwitches(undefined, [shot(60, 'b', ['event'])], new Set(['a', 'b']), 60, 120, videos, [moment(60)], 'a', refs);
  assert.deepEqual(result.map((item) => item.clipId), ['b']);
  assert.equal(result[0].start, 60);
  assert.deepEqual(result[0].evidenceRefs, ['event']);
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
test('valid local transient reference renders public rationale', () => assert.match(grounded(['transient'])[1].rationale, /Audio transient at 7\.123s/));
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
  const next = validateSectionSwitches(undefined, [shot(60, 'b', ['event'])], new Set(['a', 'b']), 60, 120, videos, [moment(60)], 'a', [{ id: 'event', type: 'audio-transient', at: 60 }]);
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

