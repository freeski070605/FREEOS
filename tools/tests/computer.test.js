import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile, unlink, rmdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { CONTROL_KEYS, computerAuditOutput, executeComputerTool, getComputerStatus, validateComputerArgs, pruneScreenshots, isComputerControlAllowed } from "@freeos/computer-core";
const require = createRequire(import.meta.url);
const { ToolRegistry, ToolRequests, ToolExecutor } = require("@freeos/tool-runner");
// Never enable either switch, and never invoke physical control during tests.
process.env.COMPUTER_CONTROL_ENABLED = "false";
process.env.COMPUTER_SCREEN_CAPTURE_ENABLED = "false";
const sampleArgs = key => key === "computer.app.launch" ? {executable:win32.join(process.env.SystemRoot || "C:\\Windows","System32","notepad.exe"),args:[]} : key === "computer.keyboard.type" ? {processId:1,text:"Foundation test text"} : key === "computer.keyboard.press" ? {processId:1,key:"Tab"} : key === "computer.keyboard.hotkey" ? {processId:1,hotkey:"CTRL+A"} : key === "computer.mouse.click" ? {processId:1,x:0,y:0,button:"left"} : key === "computer.mouse.move" ? {processId:1,x:0,y:0} : {processId:1};

test("real observation is read-only and reports both switches locked", async () => {
  const status = await getComputerStatus();
  assert.equal(status.controlEnabled,false); assert.equal(status.screenCaptureEnabled,false);
  assert.equal(status.supported,process.platform === "win32");
  if (status.supported) { assert.equal(status.health,"healthy"); assert.ok(status.primaryResolution.width > 0); assert.ok(Array.isArray(status.monitors)); }
});

test("all controls and capture fail closed without side effects", async () => {
  assert.equal(isComputerControlAllowed(),false);
  for (const key of CONTROL_KEYS) await assert.rejects(executeComputerTool(process.cwd(),key,sampleArgs(key)), error=>error.code === "blocked" && error.message.includes("locked"));
  await assert.rejects(executeComputerTool(process.cwd(),"computer.screen.capture",{}), error=>error.code === "blocked");
});

test("argument and application policy rejects execution hosts, scripts, credentials and unsafe keys", () => {
  const privateWindow={activeWindow:{processId:1,windowTitle:"Private text"},processes:[{mainWindowTitle:"Private text"}]};
  assert.ok(!JSON.stringify(computerAuditOutput("computer.status",privateWindow)).includes("Private text"));
  assert.equal(privateWindow.activeWindow.windowTitle,"Private text");
  for (const executable of ["cmd.exe","powershell.exe","pwsh.exe","wscript.exe","cscript.exe","mshta.exe","rundll32.exe","reg.exe","schtasks.exe","node.exe","python.exe","x.bat","x.cmd","x.ps1","x.vbs","x.js","C:\\Temp\\notepad.exe","C:\\Windows\\System32\\..\\cmd.exe"]) assert.throws(()=>validateComputerArgs("computer.app.launch",{executable,args:[]}));
  assert.throws(()=>validateComputerArgs("computer.app.launch",{...sampleArgs("computer.app.launch"),args:["/c","echo hello"]}));
  for (const text of ["x".repeat(4001),"hello\nworld","password=example","api_key=example"]) assert.throws(()=>validateComputerArgs("computer.keyboard.type",{processId:1,text}));
  assert.throws(()=>validateComputerArgs("computer.keyboard.hotkey",{processId:1,hotkey:"WIN+R"}));
  assert.throws(()=>validateComputerArgs("computer.keyboard.hotkey",{processId:1,hotkey:"CTRL+V"}));
  assert.throws(()=>validateComputerArgs("computer.keyboard.press",{processId:1,key:"Enter"}));
  assert.throws(()=>validateComputerArgs("computer.mouse.move",{processId:1,x:0.5,y:0}));
  assert.throws(()=>validateComputerArgs("computer.window.focus",{processId:-1}));
  assert.throws(()=>validateComputerArgs("computer.status",{script:"untrusted"}));
  assert.deepEqual(validateComputerArgs("computer.keyboard.type",{processId:1,text:"literal + ^ % {keys} $(text)"}),{processId:1,text:"literal + ^ % {keys} $(text)"});
});

test("approval, locked execution, audit redaction, replay protection and high-risk denial", async () => {
  const root=await mkdtemp(join(tmpdir(),"freeos-computer-test-"));
  const registry=new ToolRegistry({rootDir:root,databasePath:join(root,"test.sqlite")});
  try {
    registry.registerDefaultTools(); const requests=new ToolRequests(registry); const executor=new ToolExecutor(registry);
    await assert.rejects(executor.runReadOnlyTool("computer.status",{password:"never-persist-this"}));
    assert.equal(registry.database.prepare("SELECT COUNT(*) AS n FROM tool_runs WHERE args LIKE '%never-persist-this%'").get().n,0);
    for (const key of CONTROL_KEYS) {
      await assert.rejects(executor.runReadOnlyTool(key,sampleArgs(key)),e=>e.code === "blocked");
      const request=requests.createToolRequest({toolKey:key,title:"Test",args:sampleArgs(key)});
      await assert.rejects(executor.runApprovedToolRequest(request.id),e=>e.code === "blocked");
      requests.approveToolRequest(request.id);
      if (key === "computer.keyboard.type") {
        assert.equal(requests.get(request.id).args.text,"Foundation test text");
        const stored=registry.database.prepare("SELECT requested_args FROM tool_requests WHERE id=?").get(request.id).requested_args;
        assert.ok(!stored.includes("Foundation test text"));
      }
      const outcomes=await Promise.allSettled([executor.runApprovedToolRequest(request.id),executor.runApprovedToolRequest(request.id)]);
      assert.ok(outcomes.every(outcome=>outcome.status === "rejected"));
      assert.equal(requests.get(request.id).status,"blocked");
      assert.equal(registry.database.prepare("SELECT COUNT(*) AS n FROM tool_runs WHERE request_id=?").get(request.id).n,1);
    }
    const runs=requests.listToolRuns(); assert.ok(runs.every(run=>run.status === "blocked" && run.requestId !== null && run.finishedAt));
    assert.equal(runs.find(run=>run.toolKey === "computer.keyboard.type").args.text,"[redacted]");
    const expiring=requests.createToolRequest({toolKey:"computer.keyboard.type",title:"Test",args:sampleArgs("computer.keyboard.type")});
    requests.approveToolRequest(expiring.id);
    const childCode = `const {ToolRegistry,ToolExecutor}=require(${JSON.stringify(require.resolve("@freeos/tool-runner"))}); const r=new ToolRegistry({databasePath:process.argv[1],rootDir:process.argv[2]}); new ToolExecutor(r).runApprovedToolRequest(Number(process.argv[3])).then(()=>{process.exitCode=1},e=>{if(!e.message.includes('expired'))process.exitCode=2}).finally(()=>r.close());`;
    const expired=spawnSync(process.execPath,["-e",childCode,registry.databasePath,root,String(expiring.id)],{windowsHide:true});
    assert.equal(expired.status,0);
    for (const key of ["files.delete","email.send","trade.place_order","deploy.production","purchase.make","credentials.read"]) {
      assert.equal(registry.requireTool(key).enabled,false);
      assert.throws(()=>requests.createToolRequest({toolKey:key,title:"Denied",args:{}}),e=>e.code === "blocked");
      await assert.rejects(executor.runReadOnlyTool(key),e=>e.code === "blocked");
    }
    registry.database.prepare("UPDATE tool_registry SET risk_level='read_only',requires_approval=0 WHERE tool_key='computer.window.focus'").run();
    await assert.rejects(executor.runReadOnlyTool("computer.window.focus",{processId:1}),e=>e.code === "blocked");
  } finally {
    registry.close();
    for (const file of await readdir(root)) await unlink(join(root,file));
    await rmdir(root);
  }
});

test("retention removes only oldest generated PNGs within exact directory", async () => {
  const root=await mkdtemp(join(tmpdir(),"freeos-computer-retention-")); const dir=join(root,"generated","computer","screenshots");
  await mkdir(dir,{recursive:true});
  try {
    for(let i=0;i<23;i++) await writeFile(join(dir,`freeos-screen-${1700000000000+i}-00000000-0000-0000-0000-000000000000.png`),"fixture");
    await writeFile(join(dir,"personal.png"),"preserve"); await writeFile(join(root,"outside.png"),"preserve");
    await pruneScreenshots(root);
    const files=await readdir(dir); assert.equal(files.length,21); assert.ok(files.includes("personal.png")); assert.ok(!files.some(name=>name.includes("1700000000000")));
    assert.equal(await readFile(join(root,"outside.png"),"utf8"),"preserve");
  } finally {
    for(const file of await readdir(dir)) await unlink(join(dir,file));
    await unlink(join(root,"outside.png")); await rmdir(dir); await rmdir(join(root,"generated","computer")); await rmdir(join(root,"generated")); await rmdir(root);
  }
});

test("retention rejects a junction instead of touching outside files", async () => {
  const root=await mkdtemp(join(tmpdir(),"freeos-computer-links-")); const outside=await mkdtemp(join(tmpdir(),"freeos-computer-outside-"));
  const redirect=join(root,"generated");
  try { await symlink(outside,redirect,process.platform === "win32" ? "junction" : "dir"); await assert.rejects(pruneScreenshots(root),e=>e.code === "blocked"); assert.deepEqual(await readdir(outside),[]); }
  finally { await unlink(redirect); await rmdir(root); await rmdir(outside); }
});

test("fixed PowerShell parses and declares no user script evaluation", async () => {
  const source=await readFile(new URL("../../packages/computer-core/scripts/desktop.ps1",import.meta.url),"utf8");
  assert.ok(!/Invoke-Expression|ScriptBlock::Create|Start-Process/.test(source));
  if(process.platform === "win32") {
    const result=spawnSync(win32.join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoProfile","-NonInteractive","-Command","$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'packages/computer-core/scripts/desktop.ps1'),[ref]$tokens,[ref]$errors); if ($errors.Count) { exit 1 }"],{windowsHide:true});
    assert.equal(result.status,0);
  }
});
