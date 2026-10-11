import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const port = 47000 + Math.floor(Math.random() * 1000);
const token = "worker-" + "a".repeat(40);
const bridgeToken = "bridge-" + "b".repeat(40);
const temp = mkdtempSync(join(tmpdir(), "freeos-adobe-worker-"));
const worker = spawn(process.execPath, [resolve("apps/adobe-worker/dist/index.js")], { cwd: resolve("."), env: { ...process.env, FREEOS_ADOBE_ENABLED: "true", FREEOS_ADOBE_WORKER_MODE: "worker", FREEOS_ADOBE_SKIP_DISCOVERY: "true", FREEOS_ADOBE_WORKER_HOST: "127.0.0.1", FREEOS_ADOBE_WORKER_PORT: String(port), FREEOS_ADOBE_WORKER_TOKEN: token, FREEOS_ADOBE_BRIDGE_TOKEN: bridgeToken, FREEOS_ADOBE_HISTORY_PATH: join(temp, "history.jsonl"), FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS: resolve("data"), FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS: resolve("data") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let output = ""; worker.stdout.on("data", chunk => output += chunk); worker.stderr.on("data", chunk => output += chunk);
function open(url, options) { return new Promise((resolveSocket, reject) => { const socket = new WebSocket(url, options); socket._messages = []; socket.on("message", bytes => socket._messages.push(JSON.parse(bytes.toString()))); socket.once("open", () => resolveSocket(socket)); socket.once("error", reject); }); }
function receive(socket, predicate, timeout = 15000) { return new Promise((resolveMessage, reject) => { const found = socket._messages.find(predicate); if (found) { resolveMessage(found); return; } const timer = setTimeout(() => { socket.off("message", listener); reject(new Error("Timed out waiting for worker message.")); }, timeout); const listener = bytes => { const message = JSON.parse(bytes.toString()); if (!predicate(message)) return; clearTimeout(timer); socket.off("message", listener); resolveMessage(message); }; socket.on("message", listener); }); }
async function ready() { for (let i = 0; i < 100; i++) { if (output.includes("worker listening")) return; if (worker.exitCode !== null) throw new Error(`Worker exited: ${output}`); await new Promise(resolveDelay => setTimeout(resolveDelay, 100)); } throw new Error(`Worker did not start: ${output}`); }
test("worker authenticates, registers, discovers bridge capabilities, and returns job result", { timeout: 30000 }, async () => {
  try {
    await ready();
    await assert.rejects(open(`ws://127.0.0.1:${port}/adobe/worker`));
    const laptop = await open(`ws://127.0.0.1:${port}/adobe/worker`, { headers: { Authorization: `Bearer ${token}` } });
    const registered = await receive(laptop, message => message.type === "register");
    assert.ok(registered.identity.hostname); assert.ok(registered.capabilities.some(item => item.action === "app.state"));
    const bridge = await open(`ws://127.0.0.1:${port+1}/adobe/bridge`, ["freeos-v1", bridgeToken]);
    const update = receive(laptop, message => message.type === "register" && message.capabilities.some(item => item.action === "project.inspect"));
    bridge.send(JSON.stringify({ type: "bridge-register", application: "premiere", capabilities: [{ application: "premiere", action: "project.inspect", method: "native", available: true }] }));
    await update;
    const id = randomUUID();
    const commandReceived = receive(bridge, message => message.type === "bridge-command" && message.command.id === id);
    laptop.send(JSON.stringify({ type: "command", command: { id, application: "premiere", action: "project.inspect", args: {}, createdAt: new Date().toISOString() } }));
    await commandReceived;
    const completed = receive(laptop, message => message.type === "result" && message.result.jobId === id && message.result.state === "complete");
    bridge.send(JSON.stringify({ type: "bridge-result", result: { id, jobId: id, state: "complete", method: "native", output: { name: "Mock" }, timestamp: new Date().toISOString() } }));
    assert.equal((await completed).result.output.name, "Mock");
    bridge.close(); laptop.close();
  } finally { worker.kill(); worker.once("exit", () => rmSync(temp, { recursive: true, force: true })); }
});
