import { assertExecutable, canRunDirectly } from "./permissions";
import { executeSafeTool } from "./safeTools";
import type { JsonObject, ToolRun } from "./tool.types";
import { ToolRunnerError } from "./tool.types";
import { getToolRegistry, type ToolRegistry } from "./toolRegistry";
import { ToolRequests } from "./toolRequests";

export class ToolExecutor {
  readonly requests: ToolRequests;
  constructor(readonly registry: ToolRegistry = getToolRegistry()) { this.requests = new ToolRequests(registry); }

  async runReadOnlyTool(toolKey: string, args: JsonObject = {}): Promise<ToolRun> {
    const tool = this.registry.requireTool(toolKey);
    if (!canRunDirectly(tool)) throw new ToolRunnerError("Only enabled read_only tools can run without approval.", "blocked");
    return this.execute(toolKey, args, null, false);
  }

  async runApprovedToolRequest(id: number): Promise<ToolRun> {
    const request = this.requests.get(id);
    if (request.status !== "approved") throw new ToolRunnerError(`Tool request must be approved before execution; current status is ${request.status}.`, "blocked");
    const tool = this.registry.requireTool(request.toolKey);
    assertExecutable(tool, true);
    return this.execute(tool.toolKey, request.args, request.id, true);
  }

  private async execute(toolKey: string, args: JsonObject, requestId: number | null, approved: boolean): Promise<ToolRun> {
    const tool = this.registry.requireTool(toolKey); assertExecutable(tool, approved || tool.riskLevel === "read_only");
    const run = this.requests.startRun(toolKey, args, requestId);
    try { const output = await executeSafeTool(this.registry, toolKey, args); return this.requests.finishRun(run.id, "completed", output, null); }
    catch (error) { const message = error instanceof Error ? error.message : "Tool execution failed."; this.requests.finishRun(run.id, error instanceof ToolRunnerError && error.code === "blocked" ? "blocked" : "failed", null, message); throw error; }
  }
}

export const runReadOnlyTool = (toolKey: string, args?: JsonObject) => new ToolExecutor().runReadOnlyTool(toolKey, args);
export const runApprovedToolRequest = (id: number) => new ToolExecutor().runApprovedToolRequest(id);
