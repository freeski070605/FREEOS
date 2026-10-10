import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQualityResearchQueries,
  buildRequiredCapabilities,
  deriveLocalCapabilities,
  inferQualityTier,
} from "../../apps/api-server/dist/services/qualityExecution.service.js";

test("quality execution recognizes premium production intent", () => {
  assert.equal(inferQualityTier("Build a polished recurring IP character at the highest quality possible"), "premium");
  assert.equal(inferQualityTier("Create a client-ready production deliverable"), "production");
});

test("quality execution allows explicit rough work to stay draft", () => {
  assert.equal(inferQualityTier("Make a quick test blockout only"), "draft");
  assert.equal(inferQualityTier("Create a normal internal asset"), "standard");
});

const inventory = {
  operator: {
    key: "blender",
    name: "Blender Operator",
    envVar: "FREEOS_OPERATOR_BLENDER_EXE",
    processNames: ["blender"],
    executableNames: ["blender.exe"],
    capabilities: ["ui-control", "launch", "native-plan", "environment-discovery"],
    notes: "",
    configured: true,
    executablePath: "C:/Blender/blender.exe",
    executableExists: true,
    ready: true,
  },
  availableOperators: [],
  deepInspection: "blender",
  blender: {
    blenderVersion: "4.5.3 LTS",
    pythonVersion: "3.11.11",
    enabledAddonModules: ["bl_ext.blender_org.mpfb", "bl_ext.user_default.keentools"],
    addons: [
      { module: "bl_ext.blender_org.mpfb", name: "MPFB", version: "2.0.17", category: "Development", enabled: true },
      { module: "bl_ext.user_default.keentools", name: "KeenTools extension 2026.2.0", version: "2026.2.0", category: "Development", enabled: true },
      { module: "rigify", name: "Rigify", version: "0.6.10", category: "Rigging", enabled: false },
      { module: "node_wrangler", name: "Node Wrangler", version: "3.55", category: "Node", enabled: false },
    ],
    capabilitySignals: ["MPFB / MakeHuman", "KeenTools", "Rigify", "Node Wrangler"],
  },
  inspectedAt: new Date().toISOString(),
};

test("installed addons are not treated as verified operable capabilities", () => {
  const capabilities = deriveLocalCapabilities(inventory);
  const mpfb = capabilities.find(item => item.name === "MPFB / MakeHuman");
  const rigify = capabilities.find(item => item.name === "Rigify");
  assert.equal(mpfb?.installed, true);
  assert.equal(mpfb?.enabled, true);
  assert.equal(mpfb?.canUseNow, false);
  assert.equal(mpfb?.status, "enabled-unverified");
  assert.equal(rigify?.installed, true);
  assert.equal(rigify?.enabled, false);
  assert.equal(rigify?.canUseNow, false);
  assert.equal(rigify?.status, "installed-disabled");
});

test("premium character work decomposes into production capabilities", () => {
  const capabilities = deriveLocalCapabilities(inventory);
  const required = buildRequiredCapabilities("Create a premium animation-ready human character with face hair clothing topology and rig", "premium", capabilities);
  assert.ok(required.length >= 10);
  assert.equal(required.find(item => item.key === "human-base-anatomy")?.status, "candidate-local");
  assert.equal(required.find(item => item.key === "rigging")?.status, "candidate-local");
  assert.ok(required.some(item => item.key === "facial-animation"));
  assert.ok(required.some(item => item.key === "presentation"));
});

test("research prioritizes exact installed tool and Blender versions", () => {
  const queries = buildQualityResearchQueries("Create a premium production-ready stylized male character", inventory, "premium");
  assert.ok(queries.length >= 5);
  assert.match(queries[0], /MPFB \/ MakeHuman 2\.0\.17 Blender 4\.5\.3 LTS official documentation/i);
  assert.ok(queries.some(query => /KeenTools 2026\.2\.0 Blender 4\.5\.3 LTS official documentation/i.test(query)));
  assert.ok(queries.some(query => /Rigify 0\.6\.10 Blender 4\.5\.3 LTS official documentation/i.test(query)));
});
