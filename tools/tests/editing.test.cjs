const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSectionSwitches } = require('../../apps/api-server/dist/services/editing/validation/section.js');
const { buildSectionPlanSchema } = require('../../apps/api-server/dist/services/editing/planning/schemas.js');
const { critiqueTimeline } = require('../../apps/api-server/dist/services/editing/critique/editorialCritic.js');
const { classifyProject } = require('../../apps/api-server/dist/services/editing/classification/projectClassifier.js');
const { resolveEditingIntent } = require('../../apps/api-server/dist/services/editing/classification/projectIntent.js');
const { runBoundedPlanRepair, PlanRepairError } = require('../../apps/api-server/dist/services/editing/repair/planRepair.js');
const { mergeAdjacentDecisions } = require('../../apps/api-server/dist/services/editing/critique/assembly.js');

const video = (id, end = 40, start = 0, extra = {}) => ({ id, timelineAvailableStart: start, timelineAvailableEnd: end, ...extra });
const opening = (clipId) => ({ clipId, action: 'hold', confidence: 0.9, rationale: '' });
const shot = (at, clipId, rationale = 'measured motion shift') => ({ at, clipId, action: 'cut', confidence: 0.9, rationale });
const moment = (at, score = 6) => ({ at, score, reasons: ['measured motion shift'] });
const validate = ({ videos = [video('a'), video('b')], start = 0, end = 20, first = 'a', switches = [], moments = [], previous = '' } = {}) =>
  validateSectionSwitches(opening(first), switches, new Set(videos.map((v) => v.id)), start, end, videos, moments, previous);

test('continuous camera across an internal boundary', () => {
  const result = validate({ start: 10, end: 20, previous: 'a' });
  assert.deepEqual(result.map((item) => item.clipId), ['a']);
});
test('boundary cannot itself change an available camera', () => assert.throws(() => validate({ start: 10, previous: 'a', first: 'b' }), /boundary/));
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
test('non-local rationale rejected', () => assert.throws(() => validate({ switches: [shot(7, 'b', 'measured motion at 3s')], moments: [moment(7)] }), /non-local/));
test('unsupported semantic rationale rejected', () => assert.throws(() => validate({ switches: [shot(7, 'b', 'singer enters chorus')], moments: [moment(7)] }), /unsupported semantic/));
test('intentional end before full audio duration', () => assert.equal(validate({ end: 13.7 })[0].end, 13.7));
for (const count of [1, 2, 5]) test(`${count}-camera project retains legal long hold`, () => assert.equal(validate({ videos: Array.from({ length: count }, (_, i) => video(`v${i}`)), first: 'v0', end: 20 })[0].end, 20));
test('underexposed optional camera remains optional', () => assert.deepEqual(validate({ videos: [video('a'), video('b', 40, 0, { qualityFlags: [{ kind: 'underexposed' }] })] }).map((item) => item.clipId), ['a']));
test('duplicate angle can be ignored', () => assert.deepEqual(validate({ videos: [video('a'), video('b', 40, 0, { visualRole: 'same angle' })] }).map((item) => item.clipId), ['a']));
test('schema enumerates candidate times without synthetic half-second grid', () => {
  const schema = buildSectionPlanSchema(0, 20, [video('a'), video('b')], [7.123]);
  const variants = schema.properties.switches.items.oneOf;
  assert(variants.every((item) => item.properties.at.enum.every((at) => at === 7.123)));
});
const decision = (start, end, clipId) => ({ start, end, clipId, action: 'cut', confidence: 0.9, rationale: '' });
test('section merge removes artificial boundary', () => {
  const pieces = [decision(0, 10, 'a'), decision(10, 20, 'a')];
  const merged = mergeAdjacentDecisions(pieces);
  assert.deepEqual(merged, [decision(0, 20, 'a')]);
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

