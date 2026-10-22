const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { probeRender, analyzeRenderPixels, evaluateRenderQuality, compareRenderPixels, compareRenderIntervals } = require('../../apps/api-server/dist/services/premium/renderQuality.js');
const { analyzeAudio } = require('../../packages/media-intelligence/dist/index.js');
const { qualityGate } = require('../../apps/api-server/dist/services/premium/core.js');
const { videoAdapter } = require('../../apps/api-server/dist/services/premium/adapters.js');

const ffmpeg = process.env.FREEOS_FFMPEG_PATH || 'ffmpeg';
const python = process.env.FREEOS_VIDEO_PYTHON;
const available = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0 && !!python && spawnSync(python, ['-c', 'import cv2,numpy'], { stdio: 'ignore' }).status === 0;
const testMedia = available ? test : test.skip;
const dir = available ? mkdtempSync(join(tmpdir(), 'freeos-render-quality-')) : '';
function ff(args) { const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', timeout: 120000 }); assert.equal(result.status, 0, result.stderr); }
function artifact(id) { return { artifactId: id, type: 'video-review-render', domain: 'video', sourceArtifacts: [], version: 1, status: 'produced', lineage: { sourceArtifactIds: [], operation: 'test', evaluationIds: [] } }; }
function codes(e) { return e.findings.map(f => f.description); }
let media;
testMedia('generate real review fixtures and probe media streams', async () => {
  const file = name => join(dir, `${name}.mp4`);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file('clean')]);
  ff(['-i', file('clean'), '-vf', 'eq=contrast=0.35:brightness=0.22:saturation=0.65', '-c:v', 'libx264', '-c:a', 'copy', file('haze')]);
  ff(['-i', file('clean'), '-vf', 'gblur=sigma=12', '-c:v', 'libx264', '-c:a', 'copy', file('blur')]);
  ff(['-i', file('clean'), '-vf', "lut=y='if(lt(val,120),0,val)'", '-c:v', 'libx264', '-c:a', 'copy', file('crush')]);
  ff(['-i', file('clean'), '-an', '-c:v', 'copy', file('silent')]);
  media = {};
  for (const name of ['clean', 'haze', 'blur', 'crush', 'silent']) media[name] = { probe: await probeRender(file(name)), pixels: await analyzeRenderPixels(file(name)) };
  assert.equal(media.clean.probe.width, 320);
  assert.equal(media.clean.probe.audioPresent, true);
  assert.equal(media.silent.probe.audioPresent, false);
  assert.ok(media.clean.probe.filesize > 0);
  assert.ok(media.clean.pixels.frames.length >= 2);
});
testMedia('real pixels separate haze, blur, black crush and missing audio from clean media', () => {
  const evalFor = name => evaluateRenderQuality(artifact(name), media[name].probe, media[name].pixels, { audioExpected: true });
  assert.ok(!codes(evalFor('clean')).includes('video-quality.low-contrast-haze'));
  assert.ok(codes(evalFor('haze')).includes('video-quality.low-contrast-haze'));
  assert.ok(codes(evalFor('blur')).includes('video-quality.soft-render'));
  assert.ok(codes(evalFor('crush')).includes('video-quality.crushed-blacks'));
  assert.ok(codes(evalFor('silent')).includes('video-quality.audio-missing'));
  assert.equal(evalFor('silent').findings.find(f => f.description === 'video-quality.audio-missing').severity, 'blocking');
});
testMedia('source comparison detects degradation and measured improvement', () => {
  const degraded = evaluateRenderQuality(artifact('haze'), media.haze.probe, media.haze.pixels, { source: media.clean.pixels });
  assert.ok(codes(degraded).includes('video-quality.processing-regression'));
  const improved = evaluateRenderQuality(artifact('clean'), media.clean.probe, media.clean.pixels, { source: media.haze.pixels });
  assert.ok(!codes(improved).includes('video-quality.processing-regression'));
  const delta = compareRenderPixels(media.haze.pixels, media.clean.pixels);
  assert.ok(delta.localContrast > 0 && delta.sharpness > 0);
  const intervals = compareRenderIntervals(media.clean.pixels, media.haze.pixels);
  assert.ok(intervals.length >= 2 && intervals.every(item => item.localContrastDelta < 0));
});
testMedia('rendered audio analysis measures loudness, peak and coverage', async () => {
  const audio = await analyzeAudio(join(dir, 'clean.mp4'), { python, ffmpeg });
  const reviewed = evaluateRenderQuality(artifact('clean-with-audio'), media.clean.probe, media.clean.pixels, { audioExpected: true, audio });
  const presentButUninspected = evaluateRenderQuality(artifact('unexpected-audio'), media.clean.probe, media.clean.pixels);
  const presentAndInspected = evaluateRenderQuality(artifact('inspected-audio'), media.clean.probe, media.clean.pixels, { audio });
  assert.equal(typeof audio.loudness.integratedLUFS, 'number');
  assert.equal(typeof audio.loudness.truePeak, 'number');
  assert.ok(audio.durationSeconds >= media.clean.probe.duration * .9);
  assert.ok(!codes(reviewed).includes('video-quality.audio-uninspected'));
  assert.ok(codes(presentButUninspected).includes('video-quality.audio-uninspected'));
  assert.equal(presentAndInspected.dimensionScores.find(score => score.dimensionId === 'audio-quality').score, 1);
  rmSync(dir, { recursive: true, force: true });
});
testMedia('regression blocks acceptance even when an earlier haze finding was resolved', () => {
  const crush = evaluateRenderQuality(artifact('crush-v2'), media.crush.probe, media.crush.pixels);
  const editorial = { id: 'plan', evaluatorId: 'video.editing-core.plan-critic', artifactId: 'plan', reviewType: 'plan', dimensionScores: [{ dimensionId: 'editorial', score: 1, confidence: 1, measurementType: 'critic' }], findings: [], evidence: [], confidence: 1, status: 'complete', source: 'editing-core' };
  assert.ok(codes(crush).includes('video-quality.crushed-blacks'));
  assert.equal(qualityGate(videoAdapter.buildProductionProfile('test', 'premium'), [editorial, crush]).outcome, 'FAIL');
});
