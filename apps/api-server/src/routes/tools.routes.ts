import { Router } from "express";
import { ToolExecutor, ToolRequests, getToolRegistry, type JsonObject, type ToolRequestStatus } from "@freeos/tool-runner";

export const toolsRouter = Router();
const registry = () => getToolRegistry();
const requests = () => new ToolRequests(registry());
const executor = () => new ToolExecutor(registry());
const record = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

toolsRouter.get("/status", (_request, response, next) => {
  try {
    const db = registry().database;
    response.json({ phase: "Phase 5 — Safe Tool Runner + Local Automations", toolsEnabled: true, dangerousActionsEnabled: false, approvalRequiredForWrites: true, registeredToolCount: registry().listTools().length, pendingToolRequestCount: Number((db.prepare("SELECT COUNT(*) AS count FROM tool_requests WHERE status='pending'").get() as { count: number }).count), recentRunCount: Number((db.prepare("SELECT COUNT(*) AS count FROM tool_runs WHERE started_at >= datetime('now','-7 days')").get() as { count: number }).count), paidApiKeysRequired: false });
  } catch (error) { next(error); }
});
toolsRouter.get("/", (_request, response, next) => { try { response.json({ tools: registry().listTools() }); } catch (error) { next(error); } });
toolsRouter.post("/run-readonly", async (request, response, next) => { try { const body = record(request.body); response.json({ run: await executor().runReadOnlyTool(typeof body.toolKey === "string" ? body.toolKey : "", record(body.args)) }); } catch (error) { next(error); } });
toolsRouter.post("/requests", (request, response, next) => { try { const body = record(request.body); const toolRequest = requests().createToolRequest({ toolKey: typeof body.toolKey === "string" ? body.toolKey : "", title: typeof body.title === "string" ? body.title : "", description: typeof body.description === "string" ? body.description : undefined, args: record(body.args), requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : undefined }); response.status(201).json({ request: toolRequest, executed: false }); } catch (error) { next(error); } });
toolsRouter.get("/requests", (request, response, next) => { try { const status = typeof request.query.status === "string" ? request.query.status as ToolRequestStatus : undefined; if (status && !["pending", "approved", "rejected", "completed", "blocked", "failed"].includes(status)) { response.status(400).json({ error: "Invalid tool request status." }); return; } response.json({ requests: requests().listToolRequests(status) }); } catch (error) { next(error); } });
toolsRouter.post("/requests/:id/approve", async (request, response, next) => { try { const approved = requests().approveToolRequest(Number(request.params.id)); if (record(request.body).executeNow === true) { const run = await executor().runApprovedToolRequest(approved.id); response.json({ request: requests().get(approved.id), run }); return; } response.json({ request: approved, executed: false }); } catch (error) { next(error); } });
toolsRouter.post("/requests/:id/reject", (request, response, next) => { try { response.json({ request: requests().rejectToolRequest(Number(request.params.id)) }); } catch (error) { next(error); } });
toolsRouter.post("/requests/:id/run", async (request, response, next) => { try { response.json({ run: await executor().runApprovedToolRequest(Number(request.params.id)) }); } catch (error) { next(error); } });
toolsRouter.get("/runs", (request, response, next) => { try { response.json({ runs: requests().listToolRuns(Number(request.query.limit) || 100) }); } catch (error) { next(error); } });
