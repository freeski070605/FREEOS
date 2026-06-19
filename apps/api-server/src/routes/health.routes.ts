import { Router } from "express";
import type { HealthResponse } from "../types/api";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  const body: HealthResponse = {
    ok: true,
    service: "FREEOS API",
    timestamp: new Date().toISOString(),
  };
  response.json(body);
});

