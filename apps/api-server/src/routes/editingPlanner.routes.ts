import { Router } from "express";
import { buildCreativeEditPlan, type EditingPlannerRequest } from "../services/editingPlanner.service";

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
    next(error);
  }
});
