import { Router } from "express";
import {
  getProjectInspectionDraft,
  getProjectInspectionStatus,
  inspectProjectFromLearningWork,
  listProjectInspectionDrafts,
} from "../services/projectInspection.service";
import {
  getStableProjectBaselineInspectionStatus,
  inspectStableProjectFromLearningWork,
} from "../services/stableProjectBaseline.service";

export const projectInspectionRouter = Router();

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

projectInspectionRouter.get("/status", (_request, response, next) => {
  try { response.json(getProjectInspectionStatus()); }
  catch (error) { next(error); }
});

projectInspectionRouter.get("/stable-status", (_request, response, next) => {
  try { response.json(getStableProjectBaselineInspectionStatus()); }
  catch (error) { next(error); }
});

projectInspectionRouter.get("/drafts", (request, response, next) => {
  try {
    response.json({
      drafts: listProjectInspectionDrafts({
        projectKey: text(request.query.projectKey),
        limit: Number(request.query.limit) || 100,
      }),
    });
  } catch (error) { next(error); }
});

projectInspectionRouter.get("/drafts/:id", (request, response, next) => {
  try {
    const draft = getProjectInspectionDraft(Number(request.params.id));
    if (!draft) { response.status(404).json({ error: "Project inspection draft not found." }); return; }
    response.json({ draft });
  } catch (error) { next(error); }
});

projectInspectionRouter.post("/from-work/:workId", (request, response, next) => {
  try { response.status(201).json(inspectProjectFromLearningWork(Number(request.params.workId))); }
  catch (error) {
    if (error instanceof Error && /Invalid learning work|not found|not project-inspection|must be prepared|no projectKey/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

projectInspectionRouter.post("/stable-from-work/:workId", (request, response, next) => {
  try { response.status(201).json(inspectStableProjectFromLearningWork(Number(request.params.workId))); }
  catch (error) {
    if (error instanceof Error && /Invalid learning work|not found|not project-inspection|must be prepared|no projectKey|Project not found|Knowledge Governance/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});
