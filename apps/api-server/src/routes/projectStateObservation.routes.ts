import { Router } from "express";
import {
  getProjectStateObservationStatus,
  observeProjectLocalState,
} from "../services/projectStateObservation.service";

export const projectStateObservationRouter = Router();

projectStateObservationRouter.get("/status", (_request, response, next) => {
  try { response.json(getProjectStateObservationStatus()); }
  catch (error) { next(error); }
});

projectStateObservationRouter.post("/observe/:projectKey", (request, response, next) => {
  try { response.status(201).json(observeProjectLocalState(request.params.projectKey)); }
  catch (error) {
    if (error instanceof Error && /projectKey is required|No available local project source root|Unknown projectKey/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});
