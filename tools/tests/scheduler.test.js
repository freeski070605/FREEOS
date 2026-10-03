import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { Scheduler, nextRun, configureScheduler } = require("../../packages/scheduler-core/dist/index.js");
const { ToolRegistry, ToolExecutor, ToolRequests } = require("../../packages/tool-runner/dist/index.js");
function fixture(options = {}) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE system_events (id INTEGER PRIMARY KEY, event_type TEXT, message TEXT, metadata TEXT)");
  const events = { reads: [], requests: [] };
  const definitions = new Map([["read.tool", { enabled: true, riskLevel: "read_only", requiresApproval: false }], ["medium.tool", { enabled: true, riskLevel: "medium_risk", requiresApproval: true }], ["browser.click", { enabled: true, riskLevel: "medium_risk", requiresApproval: true }], ["computer.mouse.click", { enabled: true, riskLevel: "medium_risk", requiresApproval: true }], ["high.tool", { enabled: false, riskLevel: "high_risk", requiresApproval: true }]]);
  const adapter = { getTool: key => definitions.get(key) ?? null, runReadOnly: async (key, args) => { events.reads.push({key,args}); return {ok:true}; }, request: (key, args) => { events.requests.push({key,args}); if (key.startsWith("computer.") && process.env.COMPUTER_CONTROL_ENABLED !== "true") throw new Error("Computer control disabled."); return {id: events.requests.length}; } };
  const scheduler = new Scheduler(db, adapter, { enabled: true, ...options });
  return { db, scheduler, events, definitions };
}
const once = (offset = 60000) => ({ type:"once", at:new Date(Date.now() + offset).toISOString() });
const input = (key = "read.tool", config = once()) => ({ name:"Test schedule", scheduleConfig:config, actionToolKey:key, actionArgs:{ sample:1 } });
test("defaults disabled and calculates one-time, interval, daily, weekly", () => {
  const previous = process.env.SCHEDULER_ENABLED;
  delete process.env.SCHEDULER_ENABLED;
  const f = fixture({enabled:false});
  const defaultScheduler = new Scheduler(f.db, f.scheduler.adapter);
  assert.equal(defaultScheduler.status().enabled, false);
  if (previous === undefined) delete process.env.SCHEDULER_ENABLED; else process.env.SCHEDULER_ENABLED = previous;
  const after = new Date(2026, 9, 3, 7, 30);
  assert.equal(nextRun({type:"once",at:"2026-10-04T12:00:00.000Z"}, after), "2026-10-04T12:00:00.000Z");
  assert.equal(nextRun({type:"interval",everyMs:3600000,startsAt:"2026-10-03T00:00:00.000Z"}, new Date("2026-10-03T01:20:00.000Z")), "2026-10-03T02:00:00.000Z");
  assert.equal(new Date(nextRun({type:"daily",hour:8,minute:0}, after)).getHours(), 8);
  assert.equal(new Date(nextRun({type:"weekly",days:[1,3,5],hour:9,minute:0}, after)).getDay(), 1);
  f.db.close();
});
test("disabled schedule and runtime pause block execution", async () => {
  const f = fixture();
  const schedule = f.scheduler.create(input());
  f.scheduler.setEnabled(schedule.id, false);
  await f.scheduler.tick(new Date(Date.now()+120000));
  assert.equal(f.events.reads.length, 0);
  f.scheduler.setEnabled(schedule.id, true); f.scheduler.pause();
  await f.scheduler.tick(new Date(Date.now()+120000));
  assert.equal(f.events.reads.length, 0);
  f.db.close();
});
test("one occurrence is claimed once, including after service restart", async () => {
  const f = fixture();
  f.scheduler.create(input());
  const at = new Date(Date.now()+120000);
  await f.scheduler.tick(at); await f.scheduler.tick(at);
  assert.equal(f.events.reads.length, 1);
  const restarted = new Scheduler(f.db, f.scheduler.adapter, {enabled:true});
  await restarted.tick(at);
  assert.equal(f.events.reads.length, 1);
  assert.equal(restarted.runs().length, 1);
  f.db.close();
});
test("missed intervals skip forward without burst", async () => {
  const f = fixture();
  const schedule = f.scheduler.create(input("read.tool", {type:"interval",everyMs:3600000,startsAt:new Date(Date.now()+60000).toISOString()}));
  f.scheduler.skipMissed(new Date(Date.now()+5*3600000));
  assert.ok(Date.parse(f.scheduler.get(schedule.id).nextRunAt) > Date.now()+5*3600000);
  await f.scheduler.tick(new Date(Date.now()+5*3600000));
  assert.equal(f.events.reads.length, 0);
  f.db.close();
});
test("read-only auto-runs; medium and browser actions create requests; high risk is blocked", async () => {
  const f = fixture();
  f.scheduler.create(input("read.tool"));
  f.scheduler.create(input("medium.tool"));
  f.scheduler.create(input("browser.click"));
  assert.throws(() => f.scheduler.preview(input("high.tool")), /blocked/);
  await f.scheduler.tick(new Date(Date.now()+120000));
  assert.equal(f.events.reads.length, 1);
  assert.equal(f.events.requests.length, 2);
  assert.equal(f.scheduler.runs().filter(run => run.status === "pending_approval").length, 2);
  f.db.close();
});
test("computer control lock remains effective at due time", async () => {
  const previous = process.env.COMPUTER_CONTROL_ENABLED;
  delete process.env.COMPUTER_CONTROL_ENABLED;
  const f = fixture();
  try {
    f.scheduler.create(input("computer.mouse.click"));
    await f.scheduler.tick(new Date(Date.now()+120000));
    assert.equal(f.scheduler.runs()[0].status, "failed");
    assert.equal(f.scheduler.runs()[0].toolRequestId, null);
  } finally {
    if (previous === undefined) delete process.env.COMPUTER_CONTROL_ENABLED; else process.env.COMPUTER_CONTROL_ENABLED = previous;
    f.db.close();
  }
});
test("approved schedule creation and due read use Tool Runner; computer lock is rechecked", async () => {
  const root = mkdtempSync(join(tmpdir(), "freeos-scheduler-integration-"));
  const previous = process.env.COMPUTER_CONTROL_ENABLED;
  delete process.env.COMPUTER_CONTROL_ENABLED;
  const registry = new ToolRegistry({rootDir:root,databasePath:join(root,"freeos.sqlite")});
  registry.registerDefaultTools();
  const executor = new ToolExecutor(registry), requests = new ToolRequests(registry);
  const scheduler = configureScheduler(new Scheduler(registry.database, {
    getTool:key => registry.getToolByKey(key),
    runReadOnly:(key,args) => executor.runReadOnlyTool(key,args),
    request:(key,args,title) => requests.createToolRequest({toolKey:key,args,title,requestedBy:"scheduler"}),
  }, {enabled:true}));
  try {
    const definition = input("browser.status");
    const preview = await executor.runReadOnlyTool("scheduler.schedule.preview", definition);
    assert.equal(preview.output.behavior, "AUTO_RUN");
    const creation = requests.createToolRequest({toolKey:"scheduler.schedule.create",title:"Create inspected schedule",args:definition});
    requests.approveToolRequest(creation.id);
    const result = await executor.runApprovedToolRequest(creation.id);
    assert.equal(result.status, "completed");
    await scheduler.tick(new Date(Date.now()+120000));
    assert.equal(scheduler.runs()[0].status, "completed");
    assert.ok(requests.listToolRuns().some(run => run.toolKey === "browser.status"));
    const control = requests.createToolRequest({toolKey:"computer.mouse.click",title:"Locked control",args:{processId:123,x:10,y:10,button:"left"}});
    requests.approveToolRequest(control.id);
    await assert.rejects(() => executor.runApprovedToolRequest(control.id), /locked/);
  } finally {
    scheduler.stop(); registry.close(); rmSync(root,{recursive:true,force:true});
    if (previous === undefined) delete process.env.COMPUTER_CONTROL_ENABLED; else process.env.COMPUTER_CONTROL_ENABLED = previous;
  }
});
