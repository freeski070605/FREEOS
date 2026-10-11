import { Router } from "express";
import { adobeService } from "../services/adobe.service";
import type { AdobeCommand } from "@freeos/adobe-protocol";

export const adobeRouter = Router();
adobeRouter.get("/status", (_request, response) => response.json(adobeService.status()));
adobeRouter.get("/jobs/:id", (request, response) => { const job = adobeService.job(request.params.id); if (!job) { response.status(404).json({ error: "Job not found." }); return; } response.json(job); });
adobeRouter.post("/jobs", (request, response) => {
  const { application, action, args } = request.body || {};
  if (!["premiere", "after-effects", "media-encoder", "media"].includes(application) || typeof action !== "string" || !/^[a-z][a-z0-9.]{1,100}$/.test(action) || !args || typeof args !== "object" || Array.isArray(args)) { response.status(400).json({ error: "Invalid Adobe action." }); return; }
  try { const id = adobeService.submit(application as AdobeCommand["application"], action, args); response.status(202).json({ jobId: id }); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});
adobeRouter.post("/jobs/:id/cancel", (request, response) => { try { adobeService.cancel(request.params.id); response.status(202).json({ jobId: request.params.id }); } catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : String(error) }); } });
