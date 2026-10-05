import { Router } from "express";
import {
  getEvidencePromotionStatus,
  listEvidencePromotions,
  promoteProjectEvidence,
} from "../services/evidencePromotion.service";

export const evidencePromotionRouter = Router();

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const body = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

evidencePromotionRouter.get("/status", (_request, response, next) => {
  try { response.json(getEvidencePromotionStatus()); }
  catch (error) { next(error); }
});

evidencePromotionRouter.get("/items", (request, response, next) => {
  try { response.json({ items: listEvidencePromotions(text(request.query.projectKey)) }); }
  catch (error) { next(error); }
});

evidencePromotionRouter.post("/promote/:inspectionId", async (request, response, next) => {
  try {
    const input = body(request.body);
    const relativePaths = stringArray(input.relativePaths);
    if (relativePaths.length === 0) {
      response.status(400).json({ error: "relativePaths must contain at least one selected evidence candidate." });
      return;
    }
    response.status(201).json(await promoteProjectEvidence({
      inspectionId: Number(request.params.inspectionId),
      relativePaths,
      createEmbeddings: input.createEmbeddings === true,
    }));
  } catch (error) {
    if (error instanceof Error && /Invalid source evidence inspection|inspection not found|At least one relativePath|maximum of 20|not a candidate|not eligible|unavailable|no longer exists|Secret-like|not a regular file|size limit|escapes registered/.test(error.message)) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});
