import { Router } from "express";
import {
  getProjectSourceStatus,
  listProjectSources,
  projectSourceTypes,
  registerProjectSource,
  setProjectSourceEnabled,
} from "../services/projectSource.service";

export const projectSourceRouter = Router();

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const body = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

projectSourceRouter.get("/status", (_request, response, next) => {
  try { response.json(getProjectSourceStatus()); }
  catch (error) { next(error); }
});

projectSourceRouter.get("/", (request, response, next) => {
  try { response.json({ sources: listProjectSources(text(request.query.projectKey)) }); }
  catch (error) { next(error); }
});

projectSourceRouter.post("/:projectKey/register", (request, response, next) => {
  try {
    const input = body(request.body);
    const sourceType = text(input.sourceType);
    const location = text(input.location);
    if (!sourceType || !projectSourceTypes.includes(sourceType as (typeof projectSourceTypes)[number])) {
      response.status(400).json({ error: "A valid sourceType is required." });
      return;
    }
    if (!location) {
      response.status(400).json({ error: "location is required." });
      return;
    }
    response.status(201).json({
      source: registerProjectSource({
        projectKey: request.params.projectKey,
        sourceType: sourceType as (typeof projectSourceTypes)[number],
        location,
        label: text(input.label),
      }),
      indexedAutomatically: false,
      canonicalWritePerformed: false,
    });
  } catch (error) {
    if (error instanceof Error && /Unknown projectKey|location is required|absolute path/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

projectSourceRouter.post("/:id/enable", (request, response, next) => {
  try { response.json({ source: setProjectSourceEnabled(Number(request.params.id), true) }); }
  catch (error) { next(error); }
});

projectSourceRouter.post("/:id/disable", (request, response, next) => {
  try { response.json({ source: setProjectSourceEnabled(Number(request.params.id), false) }); }
  catch (error) { next(error); }
});
