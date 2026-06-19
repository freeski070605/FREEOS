import type { ErrorRequestHandler } from "express";
import { MemoryCoreError } from "@freeos/memory-core";
import { ResearchError } from "@freeos/research-core";
import { ToolRunnerError } from "@freeos/tool-runner";
import type { ErrorResponse } from "../types/api";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof MemoryCoreError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : error.code === "validation" ? 400 : 503;
    response.status(status).json({ error: error.message });
    return;
  }
  if (error instanceof ResearchError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : error.code === "validation" ? 400 : error.code === "offline" ? 503 : 502;
    response.status(status).json({ error: error.message, code: error.code, setupGuide: error.code === "offline" ? "See docs/SEARXNG_SETUP_WINDOWS.md and verify SEARXNG_BASE_URL." : undefined });
    return;
  }
  if (error instanceof ToolRunnerError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : error.code === "blocked" ? 403 : error.code === "validation" ? 400 : 503;
    response.status(status).json({ error: error.message, code: error.code, dangerousActionsEnabled: false });
    return;
  }
  console.error("[FREEOS] Unhandled API error", error);
  const body: ErrorResponse = { error: "An unexpected local API error occurred." };
  response.status(500).json(body);
};
