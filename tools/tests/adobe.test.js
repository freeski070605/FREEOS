import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { parseWireMessage, assertCapability, resolveAllowedPath } = require("../../packages/adobe-protocol/dist/index.js");
const { planPerformanceEdit, planShotMatch, planEffects, reviewFrames } = require("../../packages/editing-core/dist/index.js");
const { parseFfmpegReview } = require("../../packages/media-intelligence/dist/index.js");

test("protocol rejects arbitrary action names and malformed commands", () => {
  const command = { id: "12345678-1234-1234-1234-123456789abc", application: "premiere", action: "project.inspect", args: {}, createdAt: new Date().toISOString() };
  assert.equal(parseWireMessage(JSON.stringify({ type: "command", command })).command.action, "project.inspect");
  assert.throws(() => parseWireMessage(JSON.stringify({ type: "command", command: { ...command, action: "powershell -Command Remove-Item" } })));
  assert.throws(() => parseWireMessage(JSON.stringify({ type: "command", command: { ...command, args: "x" } })));
  assert.throws(() => parseWireMessage(JSON.stringify({ type: "bridge-register", application: "premiere", capabilities: "all" })));
});
test("capability discovery refuses absent native operations", () => {
  const capabilities = [{ application: "premiere", action: "project.inspect", method: "native", available: true }];
  assert.equal(assertCapability(capabilities, "premiere", "project.inspect").method, "native");
  assert.throws(() => assertCapability(capabilities, "premiere", "sequence.cut"));
});
test("project roots reject traversal and reparse redirects", () => {
  const dir = mkdtempSync(join(tmpdir(), "freeos-adobe-path-"));
  try {
    const allowed = join(dir, "allowed"), outside = join(dir, "outside"); mkdirSync(allowed); mkdirSync(outside);
    assert.equal(resolveAllowedPath(join(allowed, "project.prproj"), allowed), join(allowed, "project.prproj"));
    assert.throws(() => resolveAllowedPath(join(allowed, "..", "outside", "project.prproj"), allowed));
    const link = join(allowed, "redirect"); symlinkSync(outside, link, "junction");
    assert.throws(() => resolveAllowedPath(join(link, "project.prproj"), allowed));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("performance edit covers song without inventing unsynced source", () => {
  const moments = ["A", "B", "C", "D"].map((sourceClip, i) => ({ sourceClip, start: 0, end: 12, visibility: .9-i*.1, energy: .7, lipSync: .9, focus: .9, exposure: .8, composition: .8, movement: .5, unique: .6 }));
  const decisions = planPerformanceEdit({ moments, events: [{ time: 4, strength: .9, kind: "bar" }, { time: 8, strength: .9, kind: "lyric", lyric: "impact" }], duration: 12 });
  assert.equal(decisions[0].start, 0); assert.equal(decisions.at(-1).end, 12);
  assert.ok(decisions.every((decision, i) => i === 0 || decision.start === decisions[i-1].end));
  assert.ok(decisions.every(decision => moments.some(moment => moment.sourceClip === decision.sourceClip)));
  assert.throws(() => planPerformanceEdit({ moments: moments.map(m => ({ ...m, end: 5 })), events: [], duration: 12 }));
  assert.ok(planEffects(decisions).every(effect => effect.reason));
});
test("shot matching makes different corrections for different source exposures", () => {
  const plan = planShotMatch([{ clip: "A", exposureStops: -1, temperature: 4000, tint: 0, contrast: .4, saturation: .5, skinHue: 30 }, { clip: "B", exposureStops: 1, temperature: 6000, tint: .1, contrast: .6, saturation: .7, skinHue: 34 }]);
  assert.equal(plan.length, 2); assert.notEqual(plan[0].exposure, plan[1].exposure); assert.ok(plan.every(item => item.reasons.length));
});
test("render review detects black, clipped, and repeated frames", () => {
  const issues = reviewFrames([{ time: 1, luma: .001, clippedPixels: 0, duplicateOfPrevious: false }, { time: 2, luma: .8, clippedPixels: .4, duplicateOfPrevious: true }]);
  assert.deepEqual(issues.map(issue => issue.kind), ["black-frame", "overexposed", "frozen-frame"]);
});
test("FFmpeg review parser extracts measured black frames and silence", () => {
  const issues = parseFfmpegReview("black_start:1.02 black_end:1.14 black_duration:0.12\nsilence_start: 2.0\nsilence_end: 3.0 | silence_duration: 1.0");
  assert.deepEqual(issues.map(issue => issue.kind), ["black-frame", "silence"]);
  assert.equal(issues[0].start, 1.02);
});
