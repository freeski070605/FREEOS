import type { RequestHandler } from "express";

export const requestLogger: RequestHandler = (request, response, next) => {
  const startedAt = Date.now();
  response.on("finish", () => {
    console.info(`[FREEOS] ${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
};

