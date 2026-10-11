import dotenv from "dotenv";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync, mkdirSync, appendFileSync, copyFileSync } from "node:fs";
import { hostname, cpus, totalmem, networkInterfaces } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import WebSocket, { WebSocketServer } from "ws";
import { executeComputerTool, listProcesses, getComputerStatus, listWindows, captureScreen } from "@freeos/computer-core";
import { analyzeRender } from "@freeos/media-intelligence";
import { assertCapability, parseWireMessage, resolveAllowedPath, type AdobeCommand, type AdobeResult, type Capability, type WorkerIdentity, type WireMessage } from "@freeos/adobe-protocol";

dotenv.config({ path: resolve(__dirname, "../../../.env") });
const env = process.env;
const host = env.FREEOS_ADOBE_WORKER_HOST || "127.0.0.1";
const port = Number(env.FREEOS_ADOBE_WORKER_PORT || 4318);
const token = env.FREEOS_ADOBE_WORKER_TOKEN || "";
const bridgeToken = env.FREEOS_ADOBE_BRIDGE_TOKEN || "";
const root = resolve(__dirname, "../../..");
const historyPath = resolve(env.FREEOS_ADOBE_HISTORY_PATH || resolve(root, "data/adobe-worker/history.jsonl"));
const clients = new Set<WebSocket>();
const bridges = new Map<string, WebSocket>();
const jobs = new Map<string, AdobeResult>();
const pending = new Map<string, { resolve: (value: AdobeResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
let capabilities: Capability[] = [];
const versionCache = new Map<string, string>();
const executableCache = new Map<string, string | null>();
let gpuCache: string | undefined;
const probeExecutable = env.FREEOS_FFMPEG_PATH ? resolve(dirname(env.FREEOS_FFMPEG_PATH), "ffprobe.exe") : "ffprobe";
const probeAvailable = spawnSync(probeExecutable, ["-version"], { windowsHide: true, timeout: 3000, stdio: "ignore" }).status === 0;
const ffmpegExecutable = env.FREEOS_FFMPEG_PATH || "ffmpeg";
const ffmpegAvailable = spawnSync(ffmpegExecutable, ["-version"], { windowsHide: true, timeout: 3000, stdio: "ignore" }).status === 0;
if (existsSync(historyPath)) {
  for (const line of readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean).slice(-1000)) {
    try { const item = JSON.parse(line) as AdobeResult; if (item.jobId && item.state) jobs.set(item.jobId, item); } catch { /* retain valid history */ }
  }
}

function authenticate(request: IncomingMessage, expected: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer /i, "") || "";
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
function audit(result: AdobeResult, action?: string): void {
  mkdirSync(dirname(historyPath), { recursive: true });
  const output = result.state === "complete" && result.output && typeof result.output === "object" && "imageBase64" in result.output ? { ...(result.output as Record<string, unknown>), imageBase64: "[omitted from audit]" } : result.state === "complete" ? result.output : undefined;
  appendFileSync(historyPath, JSON.stringify({ ...result, action, output }) + "\n");
  jobs.set(result.jobId, result);
  for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "result", result }));
}
function executable(application: string): string | undefined {
  if (env.FREEOS_ADOBE_SKIP_DISCOVERY === "true") return undefined;
  const configured: Record<string, string | undefined> = { premiere: env.FREEOS_PREMIERE_PATH, "after-effects": env.FREEOS_AFTER_EFFECTS_PATH, "media-encoder": env.FREEOS_MEDIA_ENCODER_PATH };
  if (configured[application] && existsSync(configured[application]!)) return configured[application];
  if (executableCache.has(application)) return executableCache.get(application) || undefined;
  const names: Record<string, string> = { premiere: "Adobe Premiere Pro.exe", "after-effects": "AfterFX.exe", "media-encoder": "Adobe Media Encoder.exe" };
  for (const base of ["C:\\Program Files\\Adobe", "C:\\Program Files (x86)\\Adobe"]) {
    if (!existsSync(base)) continue;
    try {
      const path = execFileSync("powershell", ["-NoProfile", "-Command", `Get-ChildItem -LiteralPath '${base}' -Filter '${names[application]}' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`], { encoding: "utf8", timeout: 15000 }).trim();
      if (path && existsSync(path)) { executableCache.set(application, path); return path; }
    } catch { /* discovery remains unavailable */ }
  }
  executableCache.set(application, null);
  return undefined;
}
function fileVersion(path: string): string | undefined {
  if (versionCache.has(path)) return versionCache.get(path);
  try { const escaped = path.replace(/'/g, "''"); const version = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`], { encoding: "utf8", timeout: 5000 }).trim(); if (version) versionCache.set(path, version); return version || undefined; }
  catch { return undefined; }
}
function gpuName(): string | undefined {
  if (gpuCache !== undefined) return gpuCache || undefined;
  if (process.platform !== "win32") return undefined;
  try { gpuCache = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)"], { encoding: "utf8", timeout: 5000 }).trim(); }
  catch { gpuCache = ""; }
  return gpuCache || undefined;
}
async function identity(): Promise<WorkerIdentity> {
  const processes = env.FREEOS_ADOBE_SKIP_DISCOVERY === "true" ? { processes: [] } : await listProcesses().catch(() => ({ processes: [] }));
  const apps = ["premiere", "after-effects", "media-encoder"] as const;
  const names = ["Adobe Premiere Pro", "AfterFX", "Adobe Media Encoder"];
  const applications = Object.fromEntries(apps.map((app, i) => { const path = executable(app); return [app, { installed: !!path, running: processes.processes.some(p => p.processName.toLowerCase().includes(names[i].toLowerCase())), ...(path ? { path, version: fileVersion(path) } : {}) }]; })) as WorkerIdentity["applications"];
  return { id: env.FREEOS_ADOBE_WORKER_ID || hostname(), hostname: hostname(), addresses: Object.values(networkInterfaces()).flatMap(items => items || []).filter(item => item.family === "IPv4" && !item.internal).map(item => item.address), version: "0.1.0", platform: process.platform, hardware: { cpu: cpus()[0]?.model || "unknown", logicalCores: cpus().length, ramBytes: totalmem(), gpu: gpuName() }, applications };
}
async function refreshCapabilities(): Promise<Capability[]> {
  const id = await identity();
  const base: Capability[] = Object.entries(id.applications).flatMap(([application, state]) => [
    { application: application as Capability["application"], action: "app.launch", method: state.installed ? "filesystem" as const : "unavailable" as const, available: state.installed },
    { application: application as Capability["application"], action: "app.state", method: "filesystem" as const, available: true },
  ]);
  base.push({ application: "media", action: "media.probe", method: probeAvailable ? "filesystem" : "unavailable", available: probeAvailable, reason: probeAvailable ? undefined : "ffprobe was not found." });
  base.push({ application: "media", action: "media.review", method: ffmpegAvailable ? "filesystem" : "unavailable", available: ffmpegAvailable, reason: ffmpegAvailable ? undefined : "ffmpeg was not found." });
  base.push({ application: "media", action: "ui.status", method: "ui", available: true });
  base.push({ application: "media", action: "ui.windows", method: "ui", available: true });
  base.push({ application: "media", action: "ui.capture", method: "ui", available: env.COMPUTER_SCREEN_CAPTURE_ENABLED === "true", reason: env.COMPUTER_SCREEN_CAPTURE_ENABLED === "true" ? undefined : "Computer screen capture is disabled." });
  base.push({ application: "premiere", action: "project.backup", method: env.FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS ? "filesystem" : "unavailable", available: !!env.FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS, reason: env.FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS ? undefined : "Project roots are not configured." });
  for (const [application, socket] of bridges) if (socket.readyState !== WebSocket.OPEN) bridges.delete(application);
  capabilities = [...base, ...capabilities.filter(c => bridges.has(c.application) && c.method === "native")];
  return capabilities;
}
async function broadcastRegistration(): Promise<void> {
  const [id, caps] = await Promise.all([identity(), refreshCapabilities()]);
  const message = JSON.stringify({ type: "register", identity: id, capabilities: caps });
  for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(message);
}
async function run(command: AdobeCommand): Promise<AdobeResult> {
  const capability = assertCapability(await refreshCapabilities(), command.application, command.action);
  if (command.action === "app.state") return result(command, "complete", "filesystem", (await identity()).applications[command.application as keyof WorkerIdentity["applications"]]);
  if (command.action === "ui.status") return result(command, "complete", "ui", await getComputerStatus());
  if (command.action === "ui.windows") return result(command, "complete", "ui", await listWindows());
  if (command.action === "ui.capture") { const shot = await captureScreen(root); return result(command, "complete", "ui", { ...shot, imageBase64: readFileSync(resolve(root, shot.relativePath)).toString("base64") }); }
  if (command.action === "app.launch") {
    const path = executable(command.application); if (!path) throw new Error("Adobe executable was not found.");
    if (command.application === "premiere") env.FREEOS_OPERATOR_PREMIERE_EXE = path;
    if (command.application === "after-effects") env.FREEOS_OPERATOR_AFTER_EFFECTS_EXE = path;
    if (command.application === "media-encoder") env.FREEOS_MEDIA_ENCODER_PATH = path;
    const output = await executeComputerTool(root, "computer.app.launch", { executable: path, args: [] });
    return result(command, "complete", "ui", output);
  }
  if (command.action === "project.backup") {
    const path = resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS || "");
    if (!existsSync(path) || extname(path).toLowerCase() !== ".prproj") throw new Error("Premiere project is missing or has an invalid extension.");
    const backup = resolve(dirname(path), `${basename(path, ".prproj")}.freeos-backup-${Date.now()}.prproj`);
    copyFileSync(path, backup, 1);
    return result(command, "complete", "filesystem", { backup });
  }
  if (command.action === "media.probe") {
    const path = resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS || "");
    const output = execFileSync(probeExecutable, ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], { encoding: "utf8", timeout: 60000, maxBuffer: 4_000_000 });
    return result(command, "complete", "filesystem", JSON.parse(output));
  }
  if (command.action === "media.review") {
    const path = resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS || "");
    if (!existsSync(path)) throw new Error("Render file does not exist.");
    return result(command, "complete", "filesystem", await analyzeRender(ffmpegExecutable, path));
  }
  const bridge = bridges.get(command.application);
  if (["project.open", "project.saveas"].includes(command.action)) resolveAllowedPath(command.args.path, env.FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS || "");
  if (command.application === "premiere" && command.action === "sequence.clone") {
    const path = resolveAllowedPath(command.args.projectPath, env.FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS || "");
    if (!existsSync(path) || extname(path).toLowerCase() !== ".prproj") throw new Error("Source project must be an existing .prproj file.");
    const backup = resolve(dirname(path), `${basename(path, ".prproj")}.freeos-backup-${Date.now()}.prproj`);
    copyFileSync(path, backup, 1);
  }
  if (!bridge || bridge.readyState !== WebSocket.OPEN || capability.method !== "native") throw new Error("Native Adobe bridge is offline.");
  return new Promise<AdobeResult>((resolveResult, reject) => {
    const timer = setTimeout(() => { pending.delete(command.id); reject(new Error("Adobe bridge timed out.")); }, 120000);
    pending.set(command.id, { resolve: resolveResult, reject, timer });
    bridge.send(JSON.stringify({ type: "bridge-command", command }));
  });
}
function result(command: AdobeCommand, state: AdobeResult["state"], method: AdobeResult["method"], output?: unknown, error?: string): AdobeResult {
  return { id: randomUUID(), jobId: command.id, state, method, output, error, progress: state === "complete" ? 1 : 0, timestamp: new Date().toISOString() };
}
function wire(socket: WebSocket, isBridge: boolean): void {
  if (!isBridge) clients.add(socket);
  else socket.on("close", () => { for (const [app, current] of bridges) if (current === socket) bridges.delete(app); void broadcastRegistration(); });
  socket.on("message", async bytes => {
    let message: WireMessage;
    try { message = parseWireMessage(bytes.toString()); } catch { socket.close(1003, "Invalid message"); return; }
    if (isBridge && message.type === "bridge-register") { bridges.set(message.application, socket); capabilities = capabilities.filter(c => c.application !== message.application || c.method !== "native").concat(message.capabilities.filter(c => c.application === message.application && c.method === "native")); await broadcastRegistration(); return; }
    if (isBridge && message.type === "bridge-result") { const waiter = pending.get(message.result.jobId); if (waiter) { clearTimeout(waiter.timer); pending.delete(message.result.jobId); waiter.resolve(message.result); } return; }
    if (isBridge) return;
    if (message.type === "command") {
      const command = message.command;
      const prior = jobs.get(command.id);
      if (prior) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "result", result: prior })); return; }
      const queued = result(command, "queued", "unavailable"); audit(queued, command.action);
      try { audit(result(command, "running", "unavailable"), command.action); audit(await run(command), command.action); }
      catch (error) { audit(result(command, "failed", "unavailable", undefined, String(error instanceof Error ? error.message : error)), command.action); }
    }
    if (message.type === "cancel") { const active = jobs.get(message.jobId); if (active && ["queued", "waiting"].includes(active.state)) audit({ ...active, id: randomUUID(), state: "cancelled", timestamp: new Date().toISOString() }); }
  });
  socket.on("close", () => clients.delete(socket));
}
if (env.FREEOS_ADOBE_ENABLED !== "true") throw new Error("Set FREEOS_ADOBE_ENABLED=true to start the worker.");
if (env.FREEOS_ADOBE_WORKER_MODE && env.FREEOS_ADOBE_WORKER_MODE !== "worker") throw new Error("Set FREEOS_ADOBE_WORKER_MODE=worker on the AIO.");
for (const job of jobs.values()) if (["queued", "running", "waiting"].includes(job.state)) audit({ ...job, id: randomUUID(), state: "failed", error: "Worker restarted before job completion; inspect Adobe state before retrying.", timestamp: new Date().toISOString() });
if (token.length < 32 || bridgeToken.length < 32) throw new Error("Worker and bridge tokens must each contain at least 32 characters.");
if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error("Invalid worker port.");
const networkHost = host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
const cert = env.FREEOS_ADOBE_TLS_CERT; const key = env.FREEOS_ADOBE_TLS_KEY;
if (networkHost && (!cert || !key)) throw new Error("LAN binding requires a TLS certificate and key.");
const server = cert && key ? createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }) : createHttpServer();
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/adobe/worker" || !authenticate(request, token)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, ws => { wire(ws, false); void Promise.all([identity(), refreshCapabilities()]).then(([id, caps]) => { ws.send(JSON.stringify({ type: "register", identity: id, capabilities: caps })); for (const item of [...jobs.values()].slice(-100)) ws.send(JSON.stringify({ type: "result", result: item })); }); });
});
const bridgeServer = createHttpServer();
const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, handleProtocols: protocols => protocols.has("freeos-v1") ? "freeos-v1" : false });
bridgeServer.on("upgrade", (request, socket, head) => {
  const protocols = (request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim());
  const supplied = Buffer.from(protocols[1] || ""); const expected = Buffer.from(bridgeToken);
  if (request.url !== "/adobe/bridge" || protocols[0] !== "freeos-v1" || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
server.listen(port, host, () => console.log(`[FREEOS Adobe] worker listening on ${host}:${port}`));
bridgeServer.listen(port + 1, "127.0.0.1", () => console.log(`[FREEOS Adobe] local UXP bridge on 127.0.0.1:${port + 1}`));
setInterval(() => { const message = JSON.stringify({ type: "heartbeat", time: new Date().toISOString(), jobs: [...jobs.values()].map(j => ({ id: j.jobId, state: j.state, progress: j.progress || 0 })) }); for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(message); }, 5000).unref();
void getComputerStatus().then(status => console.log(`[FREEOS Adobe] desktop ${status.health}`));
