export type ToolRiskLevel = "read_only" | "low_risk_write" | "medium_risk" | "high_risk";
export type ToolRequestStatus = "pending" | "approved" | "rejected" | "completed" | "blocked" | "failed";
export type ToolRunStatus = "running" | "completed" | "failed" | "blocked";
export type JsonObject = Record<string, unknown>;

export interface ToolDefinition {
  id: number;
  toolKey: string;
  name: string;
  description: string;
  category: string;
  riskLevel: ToolRiskLevel;
  enabled: boolean;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRequest {
  id: number;
  toolKey: string;
  title: string;
  description: string;
  args: JsonObject;
  riskLevel: ToolRiskLevel;
  status: ToolRequestStatus;
  requestedBy: string;
  createdAt: string;
  reviewedAt: string | null;
  resultId: number | null;
}

export interface ToolRun {
  id: number;
  toolKey: string;
  requestId: number | null;
  status: ToolRunStatus;
  args: JsonObject;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CreateToolRequestInput {
  toolKey: string;
  title: string;
  description?: string;
  args?: JsonObject;
  requestedBy?: string;
}

export class ToolRunnerError extends Error {
  constructor(message: string, readonly code: "validation" | "not_found" | "conflict" | "blocked" | "database") {
    super(message);
    this.name = "ToolRunnerError";
  }
}
