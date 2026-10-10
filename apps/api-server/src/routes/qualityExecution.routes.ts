import { Router } from "express";
import { getOperatorStatus, type OperatorKey } from "@freeos/operator-core";
import { getToolRegistry, ToolRequests } from "@freeos/tool-runner";
import { getQualityPreflight, listQualityPreflights, runQualityPreflight } from "../services/qualityExecution.service";

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

qualityExecutionRouter.post("/preflights/:taskId/acquisition-request", (request, response, next) => {
  try {
    const taskId = Number(request.params.taskId);
    if (!Number.isInteger(taskId) || taskId < 1) { response.status(400).json({ error: "Invalid task ID." }); return; }
    const preflight = getQualityPreflight(taskId);
    if (!preflight) { response.status(404).json({ error: "Quality preflight not found." }); return; }
    const input = body(request.body);
    const candidateIndex = Number(input.candidateIndex ?? 0);
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= preflight.plan.acquisitionCandidates.length) {
      response.status(400).json({ error: "candidateIndex must select a researched acquisition candidate." });
      return;
    }
    const candidate = preflight.plan.acquisitionCandidates[candidateIndex];
    if (!candidate.sourceUrl) { response.status(400).json({ error: "Selected candidate has no evidence-backed source URL." }); return; }
    const toolRequest = new ToolRequests(getToolRegistry()).createToolRequest({
      toolKey: "operator.capability.download_candidate",
      title: `Acquire capability candidate: ${candidate.name}`,
      description: `Quality preflight for Remote Ops #${taskId} identified this candidate. Source: ${candidate.sourceUrl}. Free status: ${candidate.freeStatus}. License status: ${candidate.licenseStatus}. Approval downloads the exact artifact to FREEOS quarantine only; it does not install or execute it.`,
      args: { sourceUrl: candidate.sourceUrl },
      requestedBy: `quality-execution:${taskId}`,
    });
    response.status(201).json({ request: toolRequest, candidate, executesOnApproval: false, note: "The artifact remains quarantined after the approved Tool Runner action; installation/integration requires a compatible governed adapter." });
  } catch (error) { next(error); }
});
