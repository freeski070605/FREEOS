import { Router } from "express";
import { getQualityPreflight, listQualityPreflights, runQualityPreflight } from "../services/qualityExecution.service";
import { getOperatorStatus, type OperatorKey } from "@freeos/operator-core";

export const qualityExecutionRouter = Router();
const body = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

qualityExecutionRouter.get("/preflights", (request, response, next) => {
  try { response.json({ preflights: listQualityPreflights(Number(request.query.limit) || 50) }); }
  catch (error) { next(error); }
});

qualityExecutionRouter.get("/preflights/:taskId", (request, response, next) => {
  try {
    const taskId = Number(request.params.taskId);
    if (!Number.isInteger(taskId) || taskId < 1) { response.status(400).json({ error: "Invalid task ID." }); return; }
    const preflight = getQualityPreflight(taskId);
    if (!preflight) { response.status(404).json({ error: "Quality preflight not found." }); return; }
    response.json({ preflight });
  } catch (error) { next(error); }
});

qualityExecutionRouter.post("/preflight", async (request, response, next) => {
  try {
    const input = body(request.body);
    const taskId = Number(input.taskId);
    const operatorKey = typeof input.operatorKey === "string" ? input.operatorKey.trim() as OperatorKey : "" as OperatorKey;
    const objective = typeof input.objective === "string" ? input.objective.trim() : "";
    if (!Number.isInteger(taskId) || taskId < 1 || !objective) { response.status(400).json({ error: "taskId and objective are required." }); return; }
    getOperatorStatus(operatorKey);
    const preflight = await runQualityPreflight({ taskId, operatorKey, projectKey: typeof input.projectKey === "string" ? input.projectKey : null, objective, force: input.force === true });
    response.json({ preflight });
  } catch (error) { next(error); }
});
