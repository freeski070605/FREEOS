const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const animation = require(path.resolve(process.cwd(), "packages/animation-core/dist/index.js"));

function fakeAnalysis(overrides = {}) {
  const timeline = [];
  for (let time = 0; time < 12; time += 0.5) {
    timeline.push({
      time,
      motion: time < 6 ? 0.25 : 0.7,
      sceneChange: time === 6 ? 0.9 : 0.05,
      faceCount: 1,
      personCount: 1,
      globalMotion: time < 6 ? 0.1 : 0.6,
      localMotion: 0.4,
      shotScale: time < 6 ? "medium" : "medium-close",
      framingRole: "performance",
      motionRole: time < 6 ? "subject-motion" : "mixed-motion",
    });
  }
  return {
    path: "E:\\media\\blakeo-test.mp4",
    durationSeconds: 12,
    width: 1920,
    height: 1080,
    fps: 30,
    timeline,
    sceneChanges: [{ time: 6, strength: 0.9 }],
    qualityFlags: [{ start: 7, end: 8, kind: "blur", severity: 0.4 }],
    semanticNotes: ["Performance footage."],
    ...overrides,
  };
}

test("local-final plan creates bounded overlapping render shots", () => {
  const plan = animation.buildAnimationPlan(fakeAnalysis(), { projectId: "Blakeo Video", maxShotSeconds: 5, overlapSeconds: 0.35 });
  assert.equal(plan.projectId, "blakeo-video");
  assert.equal(plan.qualityMode, "local-final");
  assert.equal(plan.renderStrategy.workflowFamily, "wan-vace-video-to-video");
  assert.ok(plan.shots.length >= 3);
  assert.ok(plan.shots.every(shot => shot.duration <= 5.001));
  assert.ok(plan.shots.every(shot => shot.generation.height === 480));
  assert.ok(plan.shots.every(shot => shot.generation.width <= 848));
  assert.equal(plan.shots[0].controlWindow.start, 0);
  assert.ok(plan.shots[1].controlWindow.start < plan.shots[1].start);
  assert.ok(plan.shots.some(shot => shot.warnings.some(warning => warning.kind === "blur")));
});

test("portrait footage preserves orientation for generation and 1080 delivery", () => {
  const plan = animation.buildAnimationPlan(fakeAnalysis({ width: 1080, height: 1920 }), { qualityMode: "local-final" });
  assert.equal(plan.shots[0].generation.width, 480);
  assert.ok(plan.shots[0].generation.height <= 848);
  assert.equal(plan.shots[0].delivery.width, 1080);
  assert.equal(plan.shots[0].delivery.height, 1920);
});

test("render jobs stay inside the generated animation namespace", () => {
  const plan = animation.buildAnimationPlan(fakeAnalysis(), { projectId: "Blakeo Test" });
  const jobs = animation.createRenderJobs(plan);
  assert.equal(jobs.length, plan.shots.length);
  assert.ok(jobs.every(job => job.outputPrefix.startsWith("generated/animation/blakeo-test/shots/")));
  assert.ok(jobs.every(job => job.controlStart <= job.sourceStart && job.controlEnd >= job.sourceEnd));
});

test("ComfyUI endpoint policy allows only loopback HTTP", () => {
  assert.equal(animation.validateLocalComfyEndpoint("http://127.0.0.1:8188"), "http://127.0.0.1:8188");
  assert.equal(animation.validateLocalComfyEndpoint("http://localhost:8188/"), "http://localhost:8188");
  assert.throws(() => animation.validateLocalComfyEndpoint("https://127.0.0.1:8188"), /local HTTP/);
  assert.throws(() => animation.validateLocalComfyEndpoint("http://192.168.1.50:8188"), /loopback/);
  assert.throws(() => animation.validateLocalComfyEndpoint("http://example.com:8188"), /loopback/);
});
