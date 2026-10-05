import { Router } from "express";
import {
  getSourceEvidenceInspection,
  getSourceEvidenceInspectionStatus,
  inspectProjectSourceEvidence,
  listSourceEvidenceInspections,
} from "../services/sourceEvidenceInspection.service";

export const sourceEvidenceInspectionRouter = Router();

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

sourceEvidenceInspectionRouter.get("/status", (_request, response, next) => {
  try { response.json(getSourceEvidenceInspectionStatus()); }
  catch (error) { next(error); }
});

sourceEvidenceInspectionRouter.get("/inspections", (request, response, next) => {
  try { response.json({ inspections: listSourceEvidenceInspections(text(request.query.projectKey)) }); }
  catch (error) { next(error); }
});

sourceEvidenceInspectionRouter.get("/inspections/:id", (request, response, next) => {
  try {
    const inspection = getSourceEvidenceInspection(Number(request.params.id));
    if (!inspection) {
      response.status(404).json({ error: "Source evidence inspection not found." });
      return;
    }
    response.json({ inspection });
  } catch (error) { next(error); }
});

sourceEvidenceInspectionRouter.post("/inspect/:projectKey", (request, response, next) => {
  try { response.status(201).json(inspectProjectSourceEvidence(request.params.projectKey)); }
  catch (error) {
    if (error instanceof Error && /projectKey is required|No available local project source root|Unknown projectKey/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});
