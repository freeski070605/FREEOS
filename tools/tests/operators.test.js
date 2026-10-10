import test from "node:test";
import assert from "node:assert/strict";
import { downloadCapabilityArtifact, listOperators, getOperatorStatus } from "../../packages/operator-core/dist/index.js";

test("operator catalog exposes the production stack", () => {
  const items = listOperators();
  const keys = items.map(item => item.key);
  for (const key of ["blender","premiere","after-effects","photoshop","lightroom","unity","unreal","comfyui","obs","vscode"]) {
    assert.ok(keys.includes(key), `missing operator ${key}`);
  }
  const blender = items.find(item => item.key === "blender");
  assert.ok(blender.capabilities.includes("native-plan"));
  assert.ok(blender.capabilities.includes("environment-discovery"));
  for (const item of items) assert.ok(item.capabilities.includes("environment-discovery"), `${item.key} cannot participate in quality preflight`);
});

test("operator executable mapping rejects the wrong executable name", () => {
  const original = process.env.FREEOS_OPERATOR_BLENDER_EXE;
  try {
    process.env.FREEOS_OPERATOR_BLENDER_EXE = "C:\\Windows\\System32\\notepad.exe";
    assert.throws(() => getOperatorStatus("blender"), /must point to one of/i);
  } finally {
    if (original === undefined) delete process.env.FREEOS_OPERATOR_BLENDER_EXE;
    else process.env.FREEOS_OPERATOR_BLENDER_EXE = original;
  }
});

test("capability acquisition refuses non-HTTPS downloads before network access", async () => {
  await assert.rejects(
    () => downloadCapabilityArtifact(process.cwd(), "http://example.com/free-tool.zip"),
    /require HTTPS/i,
  );
});
