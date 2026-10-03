import type { CreateToolRequestInput, JsonObject, ToolRequest, ToolRequestStatus, ToolRun, ToolRunStatus } from "./tool.types";
import { ToolRunnerError } from "./tool.types";
import { getToolRegistry, type ToolRegistry } from "./toolRegistry";
import { ComputerError, computerAuditArgs, validateComputerArgs } from "@freeos/computer-core";

type Row = Record<string, unknown>;
// Typed text is volatile: reviewable during this API session, never persisted in SQLite/audit.
const textPayloads = new Map<string, string>();
const payloadKey = (registry: ToolRegistry, id: number) => `${registry.databasePath}:${id}`;
function hydrate(registry: ToolRegistry, request: ToolRequest): ToolRequest {
  if (request.toolKey === "computer.keyboard.type") { const text = textPayloads.get(payloadKey(registry, request.id)); request.args = {processId: request.args.processId, text: text ?? "[payload expired; create a new request]"}; }
  return request;
}
function json(value: unknown, fallback: unknown = {}): unknown { try { return JSON.parse(typeof value === "string" ? value : JSON.stringify(fallback)); } catch { return fallback; } }
function requestFromRow(row: Row): ToolRequest { return { id: Number(row.id), toolKey: String(row.tool_key), title: String(row.title), description: String(row.description), args: json(row.requested_args) as JsonObject, riskLevel: String(row.risk_level) as ToolRequest["riskLevel"], status: String(row.status) as ToolRequestStatus, requestedBy: String(row.requested_by), createdAt: String(row.created_at), reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at), resultId: row.result_id == null ? null : Number(row.result_id) }; }
function runFromRow(row: Row): ToolRun { return { id: Number(row.id), toolKey: String(row.tool_key), requestId: row.request_id == null ? null : Number(row.request_id), status: String(row.status) as ToolRunStatus, args: json(row.args) as JsonObject, output: row.output == null ? null : json(row.output, row.output), error: row.error == null ? null : String(row.error), startedAt: String(row.started_at), finishedAt: row.finished_at == null ? null : String(row.finished_at) }; }

export class ToolRequests {
  constructor(readonly registry: ToolRegistry = getToolRegistry()) {}
  createToolRequest(input: CreateToolRequestInput): ToolRequest {
    const tool = this.registry.requireTool(String(input.toolKey ?? "").trim());
    if (tool.toolKey.startsWith("computer.")) {
      try { validateComputerArgs(tool.toolKey, input.args ?? {}); }
      catch (error) { if (error instanceof ComputerError) throw new ToolRunnerError(error.message, error.code === "validation" ? "validation" : "blocked"); throw error; }
    }
    if (tool.toolKey.startsWith("coding.") && tool.riskLevel !== "read_only") {
      const args = input.args ?? {};
      const keys = Object.keys(args);
      const allowed = tool.toolKey === "coding.change.apply" ? ["previewId"] : tool.toolKey === "coding.session.rollback" ? ["sessionId"] : ["workspaceRoot", "command", "path"];
      if (keys.some(key => !allowed.includes(key)) || keys.length === 0 || Object.values(args).some(value => typeof value !== "string" || value.length > 500)) throw new ToolRunnerError("Invalid coding request arguments.", "validation");
    }
    if (tool.riskLevel === "read_only") throw new ToolRunnerError("Read-only tools run directly and do not use the approval queue.", "validation");
    if (tool.riskLevel === "high_risk" || !tool.enabled) {
      this.registry.logEvent("tool.request.blocked", `Blocked request for ${tool.toolKey}.`, { toolKey: tool.toolKey, requestedBy: input.requestedBy ?? "dashboard" });
      throw new ToolRunnerError(`${tool.name} is high risk and blocked in Phase 5.`, "blocked");
    }
    if (typeof input.title !== "string" || !input.title.trim()) throw new ToolRunnerError("title is required.", "validation");
    const result = this.registry.database.prepare(`INSERT INTO tool_requests (tool_key,title,description,requested_args,risk_level,status,requested_by) VALUES (?,?,?,?,?,'pending',?)`).run(tool.toolKey, tool.toolKey.startsWith("computer.") ? tool.name : input.title.trim(), tool.toolKey.startsWith("computer.") ? "Explicit Computer Operator request; inspect arguments before approval." : input.description?.trim() ?? "", JSON.stringify(computerAuditArgs(tool.toolKey, input.args ?? {})), tool.riskLevel, tool.toolKey.startsWith("computer.") ? (input.requestedBy === "command-chat" ? "command-chat" : "dashboard") : input.requestedBy?.trim() || "dashboard");
    if (tool.toolKey === "computer.keyboard.type") textPayloads.set(payloadKey(this.registry, Number(result.lastInsertRowid)), String(input.args?.text));
    const request = this.get(Number(result.lastInsertRowid));
    this.registry.logEvent("tool.request.created", `Tool request #${request.id} created.`, { requestId: request.id, toolKey: request.toolKey });
    return request;
  }
  get(id: number): ToolRequest { const row = this.registry.database.prepare("SELECT * FROM tool_requests WHERE id = ?").get(id) as Row | undefined; if (!row) throw new ToolRunnerError("Tool request not found.", "not_found"); return hydrate(this.registry, requestFromRow(row)); }
  listToolRequests(status?: ToolRequestStatus, limit = 100): ToolRequest[] { const rows = status ? this.registry.database.prepare("SELECT * FROM tool_requests WHERE status = ? ORDER BY id DESC LIMIT ?").all(status, limit) : this.registry.database.prepare("SELECT * FROM tool_requests ORDER BY id DESC LIMIT ?").all(limit); return (rows as Row[]).map(row => hydrate(this.registry, requestFromRow(row))); }
  approveToolRequest(id: number): ToolRequest { const request = this.get(id); if (request.status !== "pending") throw new ToolRunnerError(`Only pending requests can be approved; this request is ${request.status}.`, "conflict"); this.registry.database.prepare("UPDATE tool_requests SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(id); this.registry.logEvent("tool.request.approved", `Tool request #${id} approved.`, { requestId: id, toolKey: request.toolKey }); return this.get(id); }
  rejectToolRequest(id: number): ToolRequest { const request = this.get(id); if (request.status !== "pending") throw new ToolRunnerError(`Only pending requests can be rejected; this request is ${request.status}.`, "conflict"); this.registry.database.prepare("UPDATE tool_requests SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(id); textPayloads.delete(payloadKey(this.registry, id)); this.registry.logEvent("tool.request.rejected", `Tool request #${id} rejected.`, { requestId: id, toolKey: request.toolKey }); return this.get(id); }
  startRun(toolKey: string, args: JsonObject, requestId: number | null): ToolRun {
    return this.registry.database.transaction(() => {
      if (requestId !== null) {
        const request = this.get(requestId);
        const previous = this.registry.database.prepare("SELECT id FROM tool_runs WHERE request_id=?").get(requestId);
        if (request.status !== "approved" || previous) throw new ToolRunnerError("Request was already claimed or is no longer approved.", "blocked");
        if (toolKey === "computer.keyboard.type" && !textPayloads.has(payloadKey(this.registry, requestId))) throw new ToolRunnerError("Typed text expired after restart; create and review a new request.", "blocked");
      }
      const result = this.registry.database.prepare("INSERT INTO tool_runs (tool_key,request_id,status,args) VALUES (?,?,'running',?)").run(toolKey, requestId, JSON.stringify(args));
      return this.getRun(Number(result.lastInsertRowid));
    })();
  }
  finishRun(id: number, status: "completed" | "failed" | "blocked", output: unknown, error: string | null): ToolRun {
    this.registry.database.prepare("UPDATE tool_runs SET status=?,output=?,error=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").run(status, output == null ? null : JSON.stringify(output), error, id);
    const run = this.getRun(id);
    if (run.requestId) {
      textPayloads.delete(payloadKey(this.registry, run.requestId));
      this.registry.database.prepare("UPDATE tool_requests SET status=?,result_id=? WHERE id=?").run(status, id, run.requestId);
    }
    this.registry.logEvent(`tool.run.${status}`, `Tool run #${id} ${status}.`, { runId: id, requestId: run.requestId, toolKey: run.toolKey, error });
    return run;
  }
  getRun(id: number): ToolRun { const row = this.registry.database.prepare("SELECT * FROM tool_runs WHERE id=?").get(id) as Row | undefined; if (!row) throw new ToolRunnerError("Tool run not found.", "not_found"); return runFromRow(row); }
  listToolRuns(limit = 100): ToolRun[] { return (this.registry.database.prepare("SELECT * FROM tool_runs ORDER BY id DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 500)) as Row[]).map(runFromRow); }
}

export const createToolRequest = (input: CreateToolRequestInput) => new ToolRequests().createToolRequest(input);
export const approveToolRequest = (id: number) => new ToolRequests().approveToolRequest(id);
export const rejectToolRequest = (id: number) => new ToolRequests().rejectToolRequest(id);
export const listToolRequests = (status?: ToolRequestStatus) => new ToolRequests().listToolRequests(status);
export const listToolRuns = (limit?: number) => new ToolRequests().listToolRuns(limit);
