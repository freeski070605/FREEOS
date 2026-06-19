import { Router } from "express";
import {
  getMemoryStore,
  type CreateMemoryInput,
  type CreateProposalInput,
  type MemoryCategory,
  type ProposalStatus,
} from "@freeos/memory-core";

export const memoryRouter = Router();
const store = () => getMemoryStore();
const proposalStatuses: ProposalStatus[] = ["pending", "approved", "rejected"];

function bodyWithTags(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    tags: Array.isArray(body.tags)
      ? body.tags
      : typeof body.tags === "string"
        ? body.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [],
  };
}

function requestBody(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

memoryRouter.get("/status", (_request, response, next) => {
  try { response.json(store().getMemoryStatus()); } catch (error) { next(error); }
});

memoryRouter.get("/", (request, response, next) => {
  try {
    response.json({ memories: store().listApprovedMemories({
      projectKey: typeof request.query.projectKey === "string" ? request.query.projectKey : undefined,
      category: typeof request.query.category === "string" ? request.query.category as MemoryCategory : undefined,
      q: typeof request.query.q === "string" ? request.query.q : undefined,
    }) });
  } catch (error) { next(error); }
});

memoryRouter.post("/", (request, response, next) => {
  try {
    const input = bodyWithTags(requestBody(request.body)) as unknown as CreateMemoryInput;
    response.status(201).json({ memory: store().createMemory(input) });
  } catch (error) { next(error); }
});

memoryRouter.post("/proposals", (request, response, next) => {
  try {
    const input = bodyWithTags(requestBody(request.body)) as unknown as CreateProposalInput;
    response.status(201).json({ proposal: store().createProposal(input) });
  } catch (error) { next(error); }
});

memoryRouter.get("/proposals", (request, response, next) => {
  try {
    const requested = typeof request.query.status === "string" ? request.query.status : "pending";
    if (!proposalStatuses.includes(requested as ProposalStatus)) {
      response.status(400).json({ error: "status must be pending, approved, or rejected." });
      return;
    }
    response.json({ proposals: store().listProposals(requested as ProposalStatus) });
  } catch (error) { next(error); }
});

memoryRouter.post("/proposals/:id/approve", (request, response, next) => {
  try { response.json(store().approveProposal(Number(request.params.id))); } catch (error) { next(error); }
});

memoryRouter.post("/proposals/:id/reject", (request, response, next) => {
  try { response.json({ proposal: store().rejectProposal(Number(request.params.id)) }); } catch (error) { next(error); }
});
