import test from "node:test";
import assert from "node:assert/strict";
import { inferQualityTier } from "../../apps/api-server/dist/services/qualityExecution.service.js";

test("quality execution recognizes premium production intent", () => {
  assert.equal(inferQualityTier("Build a polished recurring IP character at the highest quality possible"), "premium");
  assert.equal(inferQualityTier("Create a client-ready production deliverable"), "production");
});

test("quality execution allows explicit rough work to stay draft", () => {
  assert.equal(inferQualityTier("Make a quick test blockout only"), "draft");
  assert.equal(inferQualityTier("Create a normal internal asset"), "standard");
});
