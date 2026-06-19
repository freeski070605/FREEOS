import { isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition, ToolRiskLevel } from "./tool.types";
import { ToolRunnerError } from "./tool.types";

export const ALLOWED_WRITE_DIRECTORIES = ["data", "docs", "generated", "exports"] as const;
export const WHITELISTED_SCRIPTS = ["tools-status.js"] as const;

export function classifyRisk(value: string): ToolRiskLevel {
  if (["read_only", "low_risk_write", "medium_risk", "high_risk"].includes(value)) return value as ToolRiskLevel;
  return "high_risk";
}

export function canRunDirectly(tool: ToolDefinition): boolean {
  return tool.enabled && tool.riskLevel === "read_only" && !tool.requiresApproval;
}

export function assertExecutable(tool: ToolDefinition, approved: boolean): void {
  if (!tool.enabled || tool.riskLevel === "high_risk") throw new ToolRunnerError(`${tool.name} is blocked by the Phase 5 deny-first policy.`, "blocked");
  if (tool.riskLevel !== "read_only" && (!tool.requiresApproval || !approved)) throw new ToolRunnerError("Write and action tools require an approved tool request.", "blocked");
}

export function resolveAllowedWritePath(rootDir: string, requestedPath: unknown): string {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) throw new ToolRunnerError("path is required.", "validation");
  const root = resolve(rootDir);
  const candidate = resolve(root, requestedPath.trim());
  const rel = relative(root, candidate);
  if (isAbsolute(rel) || rel.startsWith("..") || rel === "") throw new ToolRunnerError("Path must remain inside an allowed FREEOS folder.", "blocked");
  const first = rel.split(/[\\/]/)[0]?.toLowerCase();
  if (!ALLOWED_WRITE_DIRECTORIES.includes(first as typeof ALLOWED_WRITE_DIRECTORIES[number])) {
    throw new ToolRunnerError(`Writes are limited to: ${ALLOWED_WRITE_DIRECTORIES.join(", ")}.`, "blocked");
  }
  return candidate;
}
