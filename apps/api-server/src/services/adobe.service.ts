import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { assertCapability, parseWireMessage, type AdobeCommand, type AdobeResult, type Capability, type WorkerIdentity } from "@freeos/adobe-protocol";

class AdobeService {
  private socket?: WebSocket;
  private timer?: NodeJS.Timeout;
  private lastHeartbeat?: string;
  private identity?: WorkerIdentity;
  private capabilities: Capability[] = [];
  private jobs = new Map<string, AdobeResult>();
  start(): void {
    if (process.env.FREEOS_ADOBE_ENABLED !== "true") return;
    if (process.env.FREEOS_ADOBE_WORKER_MODE && process.env.FREEOS_ADOBE_WORKER_MODE !== "orchestrator") { console.error("[FREEOS Adobe] Set FREEOS_ADOBE_WORKER_MODE=orchestrator on the laptop."); return; }
    const url = process.env.FREEOS_ADOBE_WORKER_URL;
    const token = process.env.FREEOS_ADOBE_WORKER_TOKEN;
    if (!url || !token || token.length < 32) { console.error("[FREEOS Adobe] worker URL and strong token are required."); return; }
    const connect = () => {
      if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
      const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 10000, rejectUnauthorized: true });
      this.socket = socket;
      socket.on("message", bytes => {
        try {
          const message = parseWireMessage(bytes.toString());
          if (message.type === "register") { this.identity = message.identity; this.capabilities = message.capabilities; this.lastHeartbeat = new Date().toISOString(); }
          if (message.type === "heartbeat") { this.lastHeartbeat = message.time; for (const job of message.jobs) if (!this.jobs.has(job.id)) this.jobs.set(job.id, { id: job.id, jobId: job.id, state: job.state, method: "unavailable", progress: job.progress, timestamp: message.time }); }
          if (message.type === "result") this.jobs.set(message.result.jobId, message.result);
        } catch (error) { console.error("[FREEOS Adobe] invalid worker message", error); }
      });
      socket.on("error", error => console.error("[FREEOS Adobe] connection error:", error.message));
      socket.on("close", () => { this.socket = undefined; this.lastHeartbeat = undefined; });
    };
    connect(); this.timer = setInterval(connect, 5000); this.timer.unref();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.socket?.close(); }
  status() { return { enabled: process.env.FREEOS_ADOBE_ENABLED === "true", online: this.socket?.readyState === WebSocket.OPEN && !!this.lastHeartbeat && Date.now() - Date.parse(this.lastHeartbeat) < 15000, lastHeartbeat: this.lastHeartbeat, identity: this.identity, capabilities: this.capabilities, jobs: [...this.jobs.values()].sort((a,b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100).map(({ output: _output, ...summary }) => summary) }; }
  submit(application: AdobeCommand["application"], action: string, args: Record<string, unknown>): string {
    if (!this.status().online || !this.socket) throw new Error("Adobe worker is offline.");
    assertCapability(this.capabilities, application, action);
    const id = randomUUID(); const command: AdobeCommand = { id, application, action, args, createdAt: new Date().toISOString() };
    this.jobs.set(id, { id: randomUUID(), jobId: id, state: "queued", method: "unavailable", timestamp: command.createdAt, progress: 0 });
    this.socket.send(JSON.stringify({ type: "command", command }));
    return id;
  }
  cancel(id: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Adobe worker is offline.");
    this.socket.send(JSON.stringify({ type: "cancel", jobId: id }));
  }
  job(id: string) { return this.jobs.get(id); }
}
export const adobeService = new AdobeService();
