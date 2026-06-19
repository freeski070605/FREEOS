import { Router } from "express";
import { getMemoryStore, type CreateProjectNoteInput } from "@freeos/memory-core";

export const projectsRouter = Router();
const store = () => getMemoryStore();

function tagsFromBody(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string");
  if (typeof value === "string") return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

projectsRouter.get("/status", (_request, response, next) => {
  try { response.json(store().getProjectStatus()); } catch (error) { next(error); }
});

projectsRouter.get("/", (_request, response, next) => {
  try { response.json({ projects: store().listProjects() }); } catch (error) { next(error); }
});

projectsRouter.get("/:projectKey", (request, response, next) => {
  try { response.json({ project: store().getProjectDetails(request.params.projectKey) }); } catch (error) { next(error); }
});

projectsRouter.get("/:projectKey/notes", (request, response, next) => {
  try { response.json({ notes: store().listProjectNotes(request.params.projectKey) }); } catch (error) { next(error); }
});

projectsRouter.post("/:projectKey/notes", (request, response, next) => {
  try {
    const body = typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const input: CreateProjectNoteInput = {
      projectKey: request.params.projectKey,
      title: body.title as string,
      content: body.content as string,
      source: typeof body.source === "string" ? body.source : undefined,
      tags: tagsFromBody(body.tags),
    };
    response.status(201).json({ note: store().createProjectNote(input) });
  } catch (error) { next(error); }
});
