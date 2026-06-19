import { Router } from "express";
import { getSystemStatus } from "../services/system.service";

export const systemRouter = Router();

systemRouter.get("/status", (_request, response) => {
  response.json(getSystemStatus());
});

