import { Router } from "express";
import { getOllamaStatus } from "../services/ollama.service";

export const ollamaRouter = Router();

ollamaRouter.get("/status", async (_request, response, next) => {
  try {
    response.json(await getOllamaStatus());
  } catch (error) {
    next(error);
  }
});

