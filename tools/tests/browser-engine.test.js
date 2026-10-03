import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resolveBrowserEngine, BrowserOperator } = require("../../packages/browser-core/dist/index.js");
const env = { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" };
test("Chrome wins when preferred or auto, Edge falls back", () => {
  const exists = path => path.includes("chrome.exe") || path.includes("msedge.exe");
  assert.equal(resolveBrowserEngine("chrome", exists, env).activeEngine, "chrome");
  assert.equal(resolveBrowserEngine("auto", exists, env).activeEngine, "chrome");
  assert.equal(resolveBrowserEngine("edge", exists, env).activeEngine, "edge");
  assert.equal(resolveBrowserEngine("chrome", path => path.includes("msedge.exe"), env).activeEngine, "edge");
  assert.equal(resolveBrowserEngine("chrome", () => false, env).activeEngine, null);
});
test("FREEOS profile is isolated and persistent across operator instances", () => {
  const root = mkdtempSync(join(tmpdir(), "freeos-browser-profile-"));
  const previous = process.env.BROWSER_PROFILE_DIR;
  try {
    delete process.env.BROWSER_PROFILE_DIR;
    const first = new BrowserOperator(root), second = new BrowserOperator(root);
    assert.equal(first.profileDir, join(root, "data/browser/profile"));
    assert.equal(second.profileDir, first.profileDir);
    assert.equal(first.status().profilePersistent, true);
    assert.equal(first.status().profileIsolated, true);
  } finally {
    if (previous === undefined) delete process.env.BROWSER_PROFILE_DIR; else process.env.BROWSER_PROFILE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
