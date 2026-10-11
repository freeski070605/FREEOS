export type AdobeApp = "premiere" | "after-effects" | "media-encoder";
export { resolveAllowedPath } from "./security";
export type ExecutionMethod = "native" | "script" | "filesystem" | "ui" | "unavailable";
export type JobState = "queued" | "running" | "waiting" | "failed" | "complete" | "cancelled";
export interface Capability { action: string; application: AdobeApp | "media"; method: ExecutionMethod; available: boolean; reason?: string; version?: string }
export interface AdobeCommand { id: string; action: string; application: AdobeApp | "media"; args: Record<string, unknown>; createdAt: string; masterProtected?: boolean }
export interface AdobeResult { id: string; jobId: string; state: JobState; method: ExecutionMethod; output?: unknown; error?: string; progress?: number; timestamp: string }
export interface WorkerIdentity { id: string; hostname: string; addresses?: string[]; version: string; platform: string; hardware?: { cpu: string; logicalCores: number; ramBytes: number; gpu?: string }; applications: Record<AdobeApp, { installed: boolean; running: boolean; path?: string; version?: string }> }
export type WireMessage =
  | { type: "register"; identity: WorkerIdentity; capabilities: Capability[] }
  | { type: "heartbeat"; time: string; jobs: Array<{ id: string; state: JobState; progress: number }> }
  | { type: "command"; command: AdobeCommand }
  | { type: "result"; result: AdobeResult }
  | { type: "cancel"; jobId: string }
  | { type: "bridge-register"; application: AdobeApp; capabilities: Capability[] }
  | { type: "bridge-command"; command: AdobeCommand }
  | { type: "bridge-result"; result: AdobeResult };

export function parseWireMessage(raw: unknown): WireMessage {
  const value = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Message must be an object.");
  const message = value as Record<string, unknown>;
  if (!(["register", "heartbeat", "command", "result", "cancel", "bridge-register", "bridge-command", "bridge-result"] as unknown[]).includes(message.type)) throw new Error("Unknown message type.");
  if (message.type === "command" || message.type === "bridge-command") {
    const command = message.command as Record<string, unknown> | undefined;
    if (!command || typeof command.id !== "string" || !/^[a-f0-9-]{36}$/i.test(command.id) || typeof command.action !== "string" || !/^[a-z][a-z0-9.]{1,100}$/.test(command.action) || !["premiere", "after-effects", "media-encoder", "media"].includes(String(command.application)) || !command.args || typeof command.args !== "object" || Array.isArray(command.args)) throw new Error("Invalid Adobe command.");
  }
  if (message.type === "bridge-register") {
    if (!["premiere", "after-effects", "media-encoder"].includes(String(message.application)) || !Array.isArray(message.capabilities) || message.capabilities.length > 500 || !message.capabilities.every(item => item && typeof item === "object" && typeof item.action === "string" && /^[a-z][a-z0-9.]{1,100}$/.test(item.action) && item.application === message.application && ["native", "script", "filesystem", "ui", "unavailable"].includes(item.method) && typeof item.available === "boolean")) throw new Error("Invalid bridge registration.");
  }
  if (message.type === "heartbeat" && (typeof message.time !== "string" || !Array.isArray(message.jobs))) throw new Error("Invalid heartbeat.");
  if (message.type === "cancel" && (typeof message.jobId !== "string" || !/^[a-f0-9-]{36}$/i.test(message.jobId))) throw new Error("Invalid cancellation.");
  if (message.type === "register" && (!message.identity || typeof message.identity !== "object" || !Array.isArray(message.capabilities))) throw new Error("Invalid worker registration.");
  if ((message.type === "result" || message.type === "bridge-result") && (typeof (message.result as Record<string, unknown> | undefined)?.jobId !== "string" || typeof (message.result as Record<string, unknown> | undefined)?.id !== "string")) throw new Error("Invalid result.");
  return message as unknown as WireMessage;
}

export function assertCapability(capabilities: Capability[], application: AdobeCommand["application"], action: string): Capability {
  const capability = capabilities.find(item => item.application === application && item.action === action && item.available && item.method !== "unavailable");
  if (!capability) throw new Error(`Capability ${application}.${action} is unavailable on this worker.`);
  return capability;
}
