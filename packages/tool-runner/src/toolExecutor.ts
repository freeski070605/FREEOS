import { assertExecutable, canRunDirectly } from "./permissions";
import { executeSafeTool } from "./safeTools";
import type { JsonObject, ToolRun } from "./tool.types";
import { ToolRunnerError } from "./tool.types";
import { getToolRegistry, type ToolRegistry } from "./toolRegistry";
import { ToolRequests } from "./toolRequests";
import { ComputerError, computerAuditArgs, computerAuditOutput, validateComputerArgs } from "@freeos/computer-core";

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
    if (toolKey.startsWith("computer.")) {
      try { validateComputerArgs(toolKey, args); }
      catch (error) {
        this.registry.logEvent("tool.arguments.blocked", "Computer arguments rejected before audit persistence.", {toolKey, requestId});
        if (error instanceof ComputerError) throw new ToolRunnerError(error.message, error.code === "validation" ? "validation" : "blocked");
        throw error;
      }
    }
    const auditArgs = toolKey === "coding.change.preview" ? { summary: args.summary, files: Array.isArray(args.files) ? args.files.map((file: any) => ({ path: file?.path, operation: file?.operation })) : [] } : computerAuditArgs(toolKey, args);
    const run = this.requests.startRun(toolKey, auditArgs, requestId);
    try {
      const output = await executeSafeTool(this.registry, toolKey, args, { requestId: requestId ?? undefined, toolRunId: run.id });
      const auditOutput = toolKey === "coding.file.read" || toolKey === "coding.search" || toolKey === "coding.git.diff" || toolKey === "coding.git.diff_file" || toolKey === "coding.change.preview" || toolKey === "coding.command.run" ? { redacted: true } : computerAuditOutput(toolKey, output);
      const finished = this.requests.finishRun(run.id, "completed", auditOutput, null);
      return { ...finished, output };
    }
    catch (error) { const message = error instanceof Error ? error.message : "Tool execution failed."; this.requests.finishRun(run.id, error instanceof ToolRunnerError && error.code === "blocked" ? "blocked" : "failed", null, message); throw error; }
  }
}

export const runReadOnlyTool = (toolKey: string, args?: JsonObject) => new ToolExecutor().runReadOnlyTool(toolKey, args);
export const runApprovedToolRequest = (id: number) => new ToolExecutor().runApprovedToolRequest(id);
