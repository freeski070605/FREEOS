import { Router } from "express";
import { randomUUID } from "node:crypto";
import { addArtifact, currentEvaluations, qualityGate, qualityTarget, validateRepairPlan, type Artifact, type RepairPlan } from "../services/premium/core";
import { reviewEditingPlan } from "../services/premium/adapters";
import { evaluateRun, getRun, planRun, premiumRegistry, produceVideoEditPlan, saveRun } from "../services/premium/service";
import type { EditingPlan } from "../services/editing/planning/plannerTypes";
import type { EditingPlannerRequest } from "../services/editing/planning/plannerTypes";

export const premiumRouter = Router();
function bad(response: import("express").Response, error: unknown): void { response.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." }); }
premiumRouter.get("/skills", (_request, response) => response.json({ skills: [...premiumRegistry.skills.values()] }));
premiumRouter.get("/capabilities", (_request, response) => response.json({ capabilities: [...premiumRegistry.capabilities.values()].map(({ healthCheck: _healthCheck, ...safe }) => safe) }));
premiumRouter.get("/domains", (_request, response) => response.json({ domains: [...premiumRegistry.domains.keys()] }));
premiumRouter.get("/runs/:id", (request, response) => { const run = getRun(String(request.params.id)); if (!run) return response.status(404).json({ error: "Run not found." }); return response.json({ run }); });
premiumRouter.post("/plan", async (request, response) => {
  try { const { taskId, domain, userIntent, targetQuality } = request.body ?? {}; if (typeof taskId !== "string" || typeof domain !== "string" || typeof userIntent !== "string" || !userIntent.trim()) throw new Error("taskId, domain and userIntent required."); const run = await planRun(taskId, domain, userIntent, qualityTarget(targetQuality)); response.status(201).json({ run }); } catch (error) { bad(response, error); }
});
premiumRouter.post("/video/edit-plan", async (request, response) => {
  try { const { runId, input } = request.body ?? {} as { runId?: string; input?: EditingPlannerRequest }; const run = typeof runId === "string" ? getRun(runId) : undefined; if (!run || !input) throw new Error("runId and editing input required."); const result = await produceVideoEditPlan(run, input); response.json(result); } catch (error) { bad(response, error); }
});
premiumRouter.post("/evaluate", (request, response) => {
  try {
    const { runId, editingPlan } = request.body ?? {} as { runId?: string; editingPlan?: EditingPlan };
    const run = typeof runId === "string" ? getRun(runId) : undefined;
    if (!run || run.domain !== "video" || !editingPlan || !Array.isArray(editingPlan.decisions) || !editingPlan.evidence || typeof editingPlan.evidence !== "object") throw new Error("Video run and Editing Core plan required.");
    const artifact: Artifact = { artifactId: randomUUID(), type: "edit-plan", domain: "video", sourceArtifacts: [], version: 1, status: "inspected", lineage: { sourceArtifactIds: [], operation: "submitted-editing-plan-review", skillId: "video.edit.plan", capabilityId: "editing-core.local", evaluationIds: [] } };
    addArtifact(run, artifact); const evaluation = reviewEditingPlan(editingPlan, artifact); evaluation.source = "submitted-editing-plan"; artifact.lineage.evaluationIds.push(evaluation.id);
    evaluateRun(run, artifact, [evaluation]); response.json({ runId: run.runId, artifact, evaluation, gate: qualityGate(run.productionProfile, currentEvaluations(run.evaluations)) });
  } catch (error) { bad(response, error); }
});
premiumRouter.post("/repair-plan", (request, response) => {
  try { const { runId, repairs } = request.body ?? {}; const run = typeof runId === "string" ? getRun(runId) : undefined; if (!run || !Array.isArray(repairs)) throw new Error("runId and repairs required."); const plan: RepairPlan = { repairs }; validateRepairPlan(plan, currentEvaluations(run.evaluations).flatMap(e => e.findings), run, premiumRegistry); run.pendingRepairPlan = plan; run.currentStage = "repair"; saveRun(run); response.json({ repairPlan: plan, status: "validated-awaiting-approved-execution" }); } catch (error) { bad(response, error); }
});
