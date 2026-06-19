import dotenv from "dotenv";

dotenv.config();

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export const config = Object.freeze({
  port: parsePort(process.env.API_PORT, 3001),
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, ""),
  searxngBaseUrl: (process.env.SEARXNG_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, ""),
  defaultModel: process.env.FREEOS_DEFAULT_MODEL?.trim() || "qwen3:8b",
  dashboardOrigins: Array.from(new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.DASHBOARD_ORIGINS ?? process.env.DASHBOARD_ORIGIN ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ])),
});
