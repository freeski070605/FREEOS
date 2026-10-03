import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { CodingWorkspace, coding } = require("@freeos/coding-core");
const { ToolRegistry, ToolRequests, ToolExecutor } = require("@freeos/tool-runner");
const sha = value => createHash("sha256").update(value).digest("hex");
process.env.COMPUTER_CONTROL_ENABLED = "false";
process.env.COMPUTER_SCREEN_CAPTURE_ENABLED = "false";
test("coding workspace blocks traversal, secrets, binary and unsupported changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "freeos-coding-")); process.env.CODING_WORKSPACE_ROOTS = root;
  const coding = new CodingWorkspace(join(root, "sessions"));
  try {
    await writeFile(join(root, "safe.ts"), "export const n=1;\n"); await writeFile(join(root, ".env"), "secret=1"); await writeFile(join(root, "binary.ts"), Buffer.from([0,1]));
    await assert.rejects(coding.read({workspaceRoot:root,path:"../outside"}));
    await assert.rejects(coding.read({workspaceRoot:tmpdir(),path:"safe.ts"}));
    await assert.rejects(coding.read({workspaceRoot:root,path:".env"}));
    await assert.rejects(coding.read({workspaceRoot:root,path:"binary.ts"}));
    assert.match((await coding.read({workspaceRoot:root,path:"safe.ts"})).content,/const n/);
    assert.equal((await coding.inspect({workspaceRoot:root})).languageFiles.counts[".ts"],2);
    assert.equal((await coding.search({workspaceRoot:root,query:"const n"})).results[0].path,"safe.ts");
    assert.ok(typeof (await coding.gitStatus({workspaceRoot:root})).status === "string");
    assert.ok(typeof (await coding.gitDiff({workspaceRoot:root})).diff === "string");
    for (const operation of ["delete","rename","chmod"]) await assert.rejects(coding.preview({workspaceRoot:root,summary:"no",files:[{path:"safe.ts",operation,content:"x"}]}));
    await assert.rejects(coding.preview({workspaceRoot:root,summary:"no",files:[{path:"binary.ts",operation:"update",expectedSha256:sha(Buffer.from([0,1])),content:"x"}]}));
    await assert.rejects(coding.commandPreview({workspaceRoot:root,command:"powershell -Command x"}));
    await assert.rejects(coding.commandPreview({workspaceRoot:root,command:"git reset --hard"}));
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("preview, approved apply, snapshots, conflicts and rollback use temp files", async () => {
  const root = await mkdtemp(join(tmpdir(), "freeos-coding-")); process.env.CODING_WORKSPACE_ROOTS = root;
  const coding = new CodingWorkspace(join(root,"exports","coding-sessions"));
  try {
    await writeFile(join(root,"a.ts"),"before\n");
    const before = sha("before\n");
    await assert.rejects(coding.preview({workspaceRoot:root,summary:"stale",files:[{path:"a.ts",operation:"update",expectedSha256:sha("wrong"),content:"after\n"}]}));
    const set = {workspaceRoot:root,summary:"edit",files:[{path:"a.ts",operation:"update",expectedSha256:before,content:"after\n"},{path:"b.ts",operation:"create",content:"new\n"}]};
    const preview = await coding.preview(set);
    assert.equal(await readFile(join(root,"a.ts"),"utf8"),"before\n");
    assert.match(preview.files[0].diff,/\+after/);
    const stale = await coding.preview(set); await writeFile(join(root,"a.ts"),"manual\n");
    await assert.rejects(coding.apply({previewId:stale.previewId}));
    assert.equal(await readFile(join(root,"a.ts"),"utf8"),"manual\n");
    await assert.rejects(readFile(join(root,"b.ts")));
    await writeFile(join(root,"a.ts"),"before\n");
    const fresh = await coding.preview(set); const applied = await coding.apply({previewId:fresh.previewId});
    assert.equal(await readFile(join(root,"b.ts"),"utf8"),"new\n");
    assert.equal((await coding.sessions())[0].status,"applied");
    assert.equal(await readFile(join(root,"exports","coding-sessions",applied.sessionId,"before","0"),"utf8"),"before\n");
    await writeFile(join(root,"a.ts"),"later\n"); await assert.rejects(coding.rollback({sessionId:applied.sessionId}));
    await writeFile(join(root,"a.ts"),"after\n"); await coding.rollback({sessionId:applied.sessionId});
    assert.equal(await readFile(join(root,"a.ts"),"utf8"),"before\n"); await assert.rejects(readFile(join(root,"b.ts")));
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("tool runner requires approval for coding writes and command runs", async () => {
  const root = await mkdtemp(join(tmpdir(),"freeos-coding-tool-")); process.env.CODING_WORKSPACE_ROOTS=root;
  coding.sessionBase = join(root,"sessions");
  const registry = new ToolRegistry({rootDir:root,databasePath:join(root,"test.sqlite")});
  try {
    await writeFile(join(root,"package.json"),JSON.stringify({scripts:{build:"echo safe"}})); registry.registerDefaultTools();
    const executor = new ToolExecutor(registry), requests = new ToolRequests(registry);
    for (const key of ["coding.change.apply","coding.command.run","coding.session.rollback"]) await assert.rejects(executor.runReadOnlyTool(key,{}),e=>e.code==="blocked");
    const item = requests.createToolRequest({toolKey:"coding.command.run",title:"Safe build",args:{workspaceRoot:root,command:"npm run build"}});
    await assert.rejects(executor.runApprovedToolRequest(item.id),e=>e.code==="blocked");
    assert.deepEqual((await require("@freeos/coding-core").coding.commandPreview({workspaceRoot:root,command:"npm run build"})).args,["run","build"]);
    const proposed = await executor.runReadOnlyTool("coding.change.preview",{workspaceRoot:root,summary:"Create",files:[{path:"created.ts",operation:"create",content:"approved\n"}]});
    const previewId = proposed.output.previewId;
    const change = requests.createToolRequest({toolKey:"coding.change.apply",title:"Apply preview",args:{previewId}});
    await assert.rejects(executor.runApprovedToolRequest(change.id),e=>e.code==="blocked");
    requests.approveToolRequest(change.id);
    const applied = await executor.runApprovedToolRequest(change.id);
    assert.equal(await readFile(join(root,"created.ts"),"utf8"),"approved\n");
    assert.equal(applied.status,"completed");
    assert.equal((await coding.sessions())[0].requestId,change.id);
    assert.ok(!registry.database.prepare("SELECT args FROM tool_runs WHERE tool_key='coding.change.preview' ORDER BY id DESC LIMIT 1").get().args.includes("approved"));
    assert.equal(registry.requireTool("trade.place_order").enabled,false);
    assert.equal(process.env.COMPUTER_CONTROL_ENABLED,"false");
    assert.equal(process.env.COMPUTER_SCREEN_CAPTURE_ENABLED,"false");
  } finally { registry.close(); await rm(root,{recursive:true,force:true}); }
});
