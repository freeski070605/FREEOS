import { Router } from "express";
import { buildCreativeEditPlan, type EditingPlannerRequest } from "../services/editingPlanner.service";
import { buildEditingDryRun, type EditingDryRunRequest } from "../services/editingExecution.service";
import { recordEditingExperience } from "../services/editing/learning/editingExperience";
import { PlanRepairError } from "../services/editing/repair/planRepair";

export const editingPlannerRouter = Router();

editingPlannerRouter.post("/plan", async (request, response, next) => {
  try {
    const body = request.body as Partial<EditingPlannerRequest>;
    if (!body || typeof body !== "object") return response.status(400).json({ error: "JSON body required." });
    if (typeof body.audioPath !== "string" || !body.audioPath.trim()) return response.status(400).json({ error: "audioPath is required." });
    if (!Array.isArray(body.clips)) return response.status(400).json({ error: "clips must be an array." });

    for (const [index, clip] of body.clips.entries()) {
      if (!clip || typeof clip !== "object" || typeof clip.id !== "string" || !clip.id.trim() || typeof clip.path !== "string" || !clip.path.trim()) {
        return response.status(400).json({ error: `clips[${index}] requires id and path.` });
      }
    }

    const plan = await buildCreativeEditPlan(body as EditingPlannerRequest);
    response.json({ plan });
  } catch (error) {
    if (error instanceof PlanRepairError) return response.status(422).json({ error: error.message, diagnostics: error.diagnostics });
    next(error);
  }
});

editingPlannerRouter.post("/dry-run", (request, response, next) => {
  try {
    const body = request.body as Partial<EditingDryRunRequest>;
    if (!body || typeof body !== "object") return response.status(400).json({ error: "JSON body required." });
    if (!Array.isArray(body.decisions)) return response.status(400).json({ error: "decisions must be an array." });
    const dryRun = buildEditingDryRun(body as EditingDryRunRequest);
    response.json({ dryRun });
  } catch (error) {
    next(error);
  }
});

editingPlannerRouter.post("/experience", (request, response, next) => {
  try {
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") return response.status(400).json({ error: "JSON body required." });
    const required = ["editClass", "issue", "evidence", "attemptedBehavior", "result", "ownerCorrection", "proposedLesson"];
    if (required.some((key) => typeof body[key] !== "string" || !(body[key] as string).trim())) return response.status(400).json({ error: `Required: ${required.join(", ")}.` });
    const id = recordEditingExperience({
      projectKey: typeof body.projectKey === "string" ? body.projectKey : undefined,
      editClass: body.editClass as string,
      issue: body.issue as string,
      evidence: body.evidence as string,
      attemptedBehavior: body.attemptedBehavior as string,
      result: body.result as string,
      ownerCorrection: body.ownerCorrection as string,
      proposedLesson: body.proposedLesson as string,
      confidence: "moderate",
      scope: "project",
    });
    response.status(201).json({ experienceId: id, status: "observed" });
  } catch (error) { next(error); }
});
