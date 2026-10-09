import { Router } from "express";
import { remoteOpsService } from "../services/remoteOps.service";

export const remoteOpsRouter = Router();
const body = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const taskId = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Invalid task ID.");
  return parsed;
};

remoteOpsRouter.get("/status", (_request, response, next) => {
  try { response.json(remoteOpsService.status()); } catch (error) { next(error); }
});

remoteOpsRouter.get("/tasks", (request, response, next) => {
  try { response.json({ tasks: remoteOpsService.list(Number(request.query.limit) || 100) }); } catch (error) { next(error); }
});

remoteOpsRouter.post("/tasks", (request, response, next) => {
  try {
    const input = body(request.body);
    response.status(201).json({ task: remoteOpsService.enqueue({ kind: input.kind, agentId: input.agentId, projectKey: input.projectKey, objective: input.objective }) });
  } catch (error) { next(error); }
});

remoteOpsRouter.post("/pause", (_request, response, next) => {
  try { response.json(remoteOpsService.setPaused(true)); } catch (error) { next(error); }
});

remoteOpsRouter.post("/resume", (_request, response, next) => {
  try { response.json(remoteOpsService.setPaused(false)); } catch (error) { next(error); }
});

remoteOpsRouter.post("/tasks/:id/run-next", (request, response, next) => {
  try { response.json({ task: remoteOpsService.runNext(taskId(request.params.id)) }); } catch (error) { next(error); }
});

remoteOpsRouter.post("/tasks/:id/cancel", (request, response, next) => {
  try { response.json({ task: remoteOpsService.cancel(taskId(request.params.id)) }); } catch (error) { next(error); }
});
