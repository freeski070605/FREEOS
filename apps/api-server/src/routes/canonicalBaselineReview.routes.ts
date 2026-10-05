import { Router } from "express";
import {
  approveProjectBaselineReview,
  getProjectBaselineReview,
  getProjectBaselineReviewStatus,
  listProjectBaselineReviews,
  prepareProjectBaselineReview,
  projectBaselineReviewStatuses,
  rejectProjectBaselineReview,
  reviseProjectBaselineReview,
} from "../services/canonicalBaselineReview.service";

export const canonicalBaselineReviewRouter = Router();

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const body = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

canonicalBaselineReviewRouter.get("/status", (_request, response, next) => {
  try { response.json(getProjectBaselineReviewStatus()); }
  catch (error) { next(error); }
});

canonicalBaselineReviewRouter.get("/reviews", (request, response, next) => {
  try {
    const status = text(request.query.status);
    response.json({
      reviews: listProjectBaselineReviews({
        projectKey: text(request.query.projectKey),
        status: status && projectBaselineReviewStatuses.includes(status as (typeof projectBaselineReviewStatuses)[number])
          ? status as (typeof projectBaselineReviewStatuses)[number]
          : undefined,
        limit: Number(request.query.limit) || 100,
      }),
    });
  } catch (error) { next(error); }
});

canonicalBaselineReviewRouter.get("/reviews/:id", (request, response, next) => {
  try {
    const review = getProjectBaselineReview(Number(request.params.id));
    if (!review) { response.status(404).json({ error: "Project baseline review not found." }); return; }
    response.json({ review });
  } catch (error) { next(error); }
});

canonicalBaselineReviewRouter.post("/prepare/:draftId", (request, response, next) => {
  try { response.status(201).json(prepareProjectBaselineReview(Number(request.params.draftId))); }
  catch (error) {
    if (error instanceof Error && /Invalid project inspection draft|not found/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

canonicalBaselineReviewRouter.post("/reviews/:id/revise", (request, response, next) => {
  try {
    const input = body(request.body);
    const remainingUnknowns = Array.isArray(input.remainingUnknowns)
      ? input.remainingUnknowns.filter((item): item is string => typeof item === "string")
      : undefined;
    response.json(reviseProjectBaselineReview(Number(request.params.id), {
      baselineText: text(input.baselineText),
      remainingUnknowns,
      ownerNote: text(input.ownerNote),
    }));
  } catch (error) {
    if (error instanceof Error && /not found|cannot be revised|Invalid project baseline review/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

canonicalBaselineReviewRouter.post("/reviews/:id/approve", (request, response, next) => {
  try { response.json(approveProjectBaselineReview(Number(request.params.id))); }
  catch (error) {
    if (error instanceof Error && /not found|blocked|unresolved|already|Invalid project baseline review/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

canonicalBaselineReviewRouter.post("/reviews/:id/reject", (request, response, next) => {
  try {
    const input = body(request.body);
    response.json({ review: rejectProjectBaselineReview(Number(request.params.id), text(input.note) ?? "") });
  } catch (error) {
    if (error instanceof Error && /not found|cannot be rejected|Invalid project baseline review/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});
