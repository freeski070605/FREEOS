import { Router } from "express";
import { getOperatorStatus, type OperatorKey } from "@freeos/operator-core";
import { getToolRegistry, listCapabilityVerifications, ToolRequests } from "@freeos/tool-runner";
import { getQualityPreflight, listQualityPreflights, runQualityPreflight } from "../services/qualityExecution.service";

export const qualityExecutionRouter = Router();
const body = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

qualityExecutionRouter.get("/preflights", (request, response, next) => {
  try { response.json({ preflights: listQualityPreflights(Number(request.query.limit) || 50) }); }
  catch (error) { next(error); }
});

qualityExecutionRouter.get("/capabilities", (request, response, next) => {
  try {
    const operatorKey = typeof request.query.operatorKey === "string" && request.query.operatorKey.trim() ? request.query.operatorKey.trim() : undefined;
    response.json({ capabilities: listCapabilityVerifications(operatorKey) });
  } catch (error) { next(error); }
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

function requireMpfbPreflight(taskId: number) {
  if (!Number.isInteger(taskId) || taskId < 1) throw new Error("Invalid task ID.");
  const preflight = getQualityPreflight(taskId);
  if (!preflight) throw new Error("Quality preflight not found.");
  if (preflight.operatorKey !== "blender") throw new Error("MPFB capability verification is only valid for Blender quality preflights.");
  const mpfb = preflight.plan.localCapabilities.find(item => /mpfb|makehuman/i.test(item.name));
  if (!mpfb?.installed || !mpfb.enabled) throw new Error("MPFB is not currently verified as installed and enabled in this preflight. Re-run environment inspection/preflight first.");
  return preflight;
}

qualityExecutionRouter.post("/preflights/:taskId/mpfb-smoke-request", (request, response, next) => {
  try {
    const taskId = Number(request.params.taskId);
    requireMpfbPreflight(taskId);
    const jobKey = `quality-task-${taskId}-mpfb-base`;
    const toolRequest = new ToolRequests(getToolRegistry()).createToolRequest({
      toolKey: "operator.blender.mpfb.smoke_test",
      title: `Verify MPFB base-human capability for task #${taskId}`,
      description: `Runs FREEOS's fixed MPFB base-human smoke adapter for quality task #${taskId}. It invokes only the governed mpfb.create_human path, saves diagnostic evidence inside the FREEOS workspace, and does not execute arbitrary web-provided code.`,
      args: { jobKey },
      requestedBy: `quality-execution:${taskId}`,
    });
    response.status(201).json({
      request: toolRequest,
      jobKey,
      executesOnApproval: false,
      note: "Approve and run this Tool Runner request to verify that FREEOS can actually create and visually verify an MPFB base human. Passing this smoke test verifies only the base-human stage, not the full premium character workflow.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MPFB request failed.";
    response.status(/not found/i.test(message) ? 404 : /Invalid task/i.test(message) ? 400 : 409).json({ error: message });
  }
});

qualityExecutionRouter.post("/preflights/:taskId/mpfb-phenotype-request", (request, response, next) => {
  try {
    const taskId = Number(request.params.taskId);
    requireMpfbPreflight(taskId);
    const input = body(request.body);
    const supplied = body(input.profile);
    const profile = Object.keys(supplied).length ? supplied : {
      gender: "male",
      age: "young",
      muscle: "averagemuscle",
      weight: "averageweight",
      height: "average",
      proportions: "max",
      race: "universal",
      influence: 0.8,
    };
    const jobKey = `quality-task-${taskId}-mpfb-phenotype`;
    const toolRequest = new ToolRequests(getToolRegistry()).createToolRequest({
      toolKey: "operator.blender.mpfb.phenotype_test",
      title: `Verify MPFB phenotype controls for task #${taskId}`,
      description: `Runs FREEOS's governed MPFB phenotype adapter using a structured, allowlisted profile. The default profile is a neutral-reference young male with moderate muscle/weight, wider-shoulder proportions, universal race blend, and 0.8 influence. This is a capability verification profile, not final character art direction.`,
      args: { jobKey, profile },
      requestedBy: `quality-execution:${taskId}`,
    });
    response.status(201).json({
      request: toolRequest,
      jobKey,
      profile,
      executesOnApproval: false,
      note: "Approve and run this Tool Runner request. Passing verifies that FREEOS can intentionally drive MPFB phenotype controls and prove active shape-key effects; it still does not verify premium face sculpting, hair, clothing, rigging, or final materials.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MPFB phenotype request failed.";
    response.status(/not found/i.test(message) ? 404 : /Invalid task/i.test(message) ? 400 : 409).json({ error: message });
  }
});

qualityExecutionRouter.post("/preflights/:taskId/mpfb-detail-request", (request, response, next) => {
  try {
    const taskId = Number(request.params.taskId);
    requireMpfbPreflight(taskId);
    const input = body(request.body);
    const supplied = body(input.profile);
    const profile = Object.keys(supplied).length ? supplied : {
      noseVolume: 0.28,
      noseWidth: 0.18,
      chinProminence: 0.30,
      chinHeight: 0.12,
      cupidBow: 0.16,
      cupidBowWidth: 0.12,
    };
    const jobKey = `quality-task-${taskId}-mpfb-detail`;
    const toolRequest = new ToolRequests(getToolRegistry()).createToolRequest({
      toolKey: "operator.blender.mpfb.detail_test",
      title: `Verify MPFB fine-detail controls for task #${taskId}`,
      description: `Runs FREEOS's governed MPFB fine-detail adapter. Each bounded semantic slider maps only to a fixed built-in MPFB target pair for nose, chin, or mouth detail. The adapter verifies non-macro shape-key effects and creates a portrait diagnostic render.`,
      args: { jobKey, profile },
      requestedBy: `quality-execution:${taskId}`,
    });
    response.status(201).json({
      request: toolRequest,
      jobKey,
      profile,
      executesOnApproval: false,
      note: "Approve and run this request. Passing proves that FREEOS can move beyond macro phenotype controls into specific facial modeling targets. The default values are intentionally moderate capability-test values, not final art direction.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MPFB detail request failed.";
    response.status(/not found/i.test(message) ? 404 : /Invalid task/i.test(message) ? 400 : 409).json({ error: message });
  }
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
