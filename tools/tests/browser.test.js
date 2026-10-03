import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { BrowserOperator, normalizeUrl, BrowserError, browserAuditArgs, safeBrowserUrl } = require("../../packages/browser-core/dist/index.js");
const { ToolRegistry, ToolRequests, ToolExecutor } = require("../../packages/tool-runner/dist/index.js");

test("URL policy normalizes origins and refuses privileged schemes and credentials", () => {
  assert.equal(normalizeUrl("HTTPS://Example.COM:443/a#part").origin, "https://example.com");
  for (const url of ["file:///a", "javascript:alert(1)", "data:text/plain,a", "chrome://settings", "about:blank", "ftp://x", "shell:open", "https://user:secret@example.com"]) assert.throws(() => normalizeUrl(url), BrowserError);
  assert.ok(!safeBrowserUrl("https://example.com/?token=secret").includes("secret"));
});

test("isolated profile rejects outside and redirected storage", () => {
  const root = mkdtempSync(join(tmpdir(), "freeos-browser-path-")); const old = process.env.BROWSER_PROFILE_DIR;
  try { process.env.BROWSER_PROFILE_DIR = "../personal"; assert.throws(() => new BrowserOperator(root), /inside data\/browser/); process.env.BROWSER_PROFILE_DIR = "data/browser/profile"; const op = new BrowserOperator(root); assert.equal(op.profileDir, join(root, "data/browser/profile")); op.setPermissions([{origin:"http://localhost:1234", enabled:false, permissions:["observe", "navigate"]}]); assert.equal(op.permission("http://localhost:1234", "observe"), false); }
  finally { if (old === undefined) delete process.env.BROWSER_PROFILE_DIR; else process.env.BROWSER_PROFILE_DIR = old; rmSync(root, {recursive:true,force:true}); }
});

test("local fixture: observation, bounded text, links, forms, refs, approvals and blocked intent", async () => {
  const root = mkdtempSync(join(tmpdir(), "freeos-browser-test-"));
  const server = createServer((req, res) => { res.setHeader("Content-Type", "text/html"); if (req.url === "/redirect") { res.writeHead(302, {Location:"https://example.com/forbidden"}); res.end(); return; } if (req.url === "/next") { res.end("<h1>Next</h1>"); return; } res.end('<h1>Fixture page</h1><main><a href="/next">Next page</a><button id="safe">Safe button</button><button>Buy now</button><button>Place trade</button><button>Send message</button><button>Publish post</button><form action="/submit" method="post"><label>Name <input name="name"></label><label>Password <input name="password" type="password"></label><label>Card <input name="credit_card"></label><button type="submit">Submit</button></form><form action="/safe" method="post"><label>Search <input name="search"></label><button type="submit">Submit search</button></form><p>BOUND ' + "x".repeat(300) + "</p></main>"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const old = Object.fromEntries(["BROWSER_CONTROL_ENABLED", "BROWSER_MAX_TEXT_CHARS", "BROWSER_PROFILE_DIR", "BROWSER_DOWNLOAD_DIR"].map(k => [k, process.env[k]]));
  process.env.BROWSER_CONTROL_ENABLED = "true"; process.env.BROWSER_MAX_TEXT_CHARS = "80"; delete process.env.BROWSER_PROFILE_DIR; delete process.env.BROWSER_DOWNLOAD_DIR;
  const op = new BrowserOperator(root); const registry = new ToolRegistry({ rootDir: root, databasePath: join(root, "test.sqlite") }); registry.registerDefaultTools(); const requests = new ToolRequests(registry); const executor = new ToolExecutor(registry);
  try {
    assert.equal(op.status().controlEnabled, true); assert.equal(op.permission(origin, "observe"), true); assert.equal(op.permission(origin, "interact"), false);
    assert.equal(op.preview(`${origin}/`).currentUrl, null); assert.equal(op.tabsList().length, 0);
    op.setPermissions([{origin, enabled:true, permissions:["observe", "navigate", "interact"]}]);
    await op.start(); const tab = op.tabsList()[0]; assert.ok(tab.id); assert.equal(op.sessions()[0].status, "active");
    await op.navigate(`${origin}/`, tab.id, 12); const inspect = await op.inspect(tab.id); assert.equal(inspect.headings[0].text, "Fixture page"); assert.ok(inspect.elements.every(e => e.refId));
    assert.equal((await op.links(tab.id)).links[0].text, "Next page"); const forms = await op.forms(tab.id); assert.equal(forms.forms[0].method, "post"); assert.equal(forms.forms[0].fields[1].sensitive, true);
    const text = await op.text(tab.id); assert.equal(text.text.length, 80); assert.equal(text.truncated, true);
    const current = await op.inspect(tab.id); const safe = current.buttons.find(e => e.name === "Safe button"); const buy = current.buttons.find(e => e.name === "Buy now"); const card = current.inputs.find(e => e.name === "Card"); const password = current.inputs.find(e => e.name === "Password");
    assert.throws(() => op.validateAction("browser.click", {tabId:tab.id,refId:buy.refId}), /High-impact/); assert.throws(() => op.validateAction("browser.input", {tabId:tab.id,refId:card.refId,value:"1"}), /Financial/);
    for (const label of ["Place trade", "Send message", "Publish post"]) assert.throws(() => op.validateAction("browser.click", {tabId:tab.id,refId:current.buttons.find(e => e.name === label).refId}), /High-impact/);
    await assert.rejects(() => op.formPreview(tab.id, current.buttons.find(e => e.name === "Submit").refId), /High-impact/);
    const safeSubmit = current.buttons.find(e => e.name === "Submit search"); assert.throws(() => op.cachedFormPreview(tab.id, safeSubmit.refId), /Preview/); const formPreview = await op.formPreview(tab.id, safeSubmit.refId); assert.equal(formPreview.method, "post"); assert.equal(op.cachedFormPreview(tab.id, safeSubmit.refId).submitButton, "Submit search");
    assert.equal(op.validateAction("browser.input", {tabId:tab.id,refId:password.refId,value:"secret"}).sensitive, true);
    assert.equal(op.validateAction("browser.click", {tabId:tab.id,refId:safe.refId}).refId, safe.refId);
    assert.equal(registry.requireTool("browser.click").requiresApproval, true); assert.equal(registry.requireTool("browser.form.submit").requiresApproval, true);
    await assert.rejects(() => executor.runReadOnlyTool("browser.click", {tabId:tab.id,refId:safe.refId}), /approved Tool Runner request/);
    assert.equal(browserAuditArgs("browser.input", {tabId:tab.id,refId:password.refId,value:"secret"}).value, "[redacted]");
    const request = requests.createToolRequest({toolKey:"browser.navigate", title:"Navigate", args:{url:origin}});
    assert.ok(!readFileSync(join(root,"test.sqlite")).includes?.("secret"));
    await assert.rejects(() => executor.runApprovedToolRequest(request.id), /approved/);
    await op.tabs.get(tab.id).page.evaluate(() => { const replacement = document.createElement("button"); replacement.textContent = "Safe button"; document.getElementById("safe").replaceWith(replacement); });
    await assert.rejects(() => op.action("browser.click", {tabId:tab.id,refId:safe.refId}), /changed/);
    await op.navigate(`${origin}/next`, tab.id, 13); assert.throws(() => op.validateAction("browser.click", {tabId:tab.id,refId:safe.refId}), /stale/);
    await assert.rejects(() => op.navigate(`${origin}/redirect`, tab.id, 14));
    assert.equal(registry.requireTool("browser.download").requiresApproval, true); assert.throws(() => op.validateAction("browser.download", {filename:"../bad.exe"}), /Downloads/);
    assert.throws(() => op.validateAction("browser.evaluate", {script:"alert(1)"}), /Unsupported/);
    assert.throws(() => op.validateAction("browser.shell", {command:"whoami"}), /Unsupported/);
    await op.stop(); assert.equal(op.sessions()[0].status, "stopped"); assert.equal(op.tabsList().length, 0);
    const history = JSON.parse(readFileSync(join(root, "data/browser/sessions.json"), "utf8")); assert.equal(history[0].status, "stopped"); assert.equal(history[0].tabIds[0], tab.id); assert.ok(history[0].actions.some(a => a.requestId === 12));
  } finally { await op.stop(); registry.close(); await new Promise(resolve => server.close(resolve)); for (const [k,v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(root,{recursive:true,force:true}); }
});
