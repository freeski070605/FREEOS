import { assertExecutable, canRunDirectly } from "./permissions";
import { executeSafeTool } from "./safeTools";
import type { JsonObject, ToolRun } from "./tool.types";
import { ToolRunnerError } from "./tool.types";
import { getToolRegistry, type ToolRegistry } from "./toolRegistry";
import { ToolRequests } from "./toolRequests";
import { ComputerError, computerAuditArgs, computerAuditOutput, validateComputerArgs } from "@freeos/computer-core";
import { browserAuditArgs, isBrowserActionKey } from "@freeos/browser-core";
import { AgentStore } from "@freeos/agent-core";
import { getMemoryStore } from "@freeos/memory-core";
import { executeOperatorTool, isOperatorTool } from "./operatorTools";

export class ToolExecutor {
  readonly requests: ToolRequests;
  constructor(readonly registry: ToolRegistry = getToolRegistry()) { this.requests = new ToolRequests(registry); }

  async runReadOnlyTool(toolKey: string, args: JsonObject = {}): Promise<ToolRun> {
    if (isBrowserActionKey(toolKey)) throw new ToolRunnerError("Browser actions require an approved Tool Runner request.", "blocked");
    const tool = this.registry.requireTool(toolKey);
    if (!canRunDirectly(tool)) throw new ToolRunnerError("Only enabled read_only tools can run without approval.", "blocked");
    return this.execute(toolKey, args, null, false);
  }

  async runApprovedToolRequest(id: number): Promise<ToolRun> {
    const request = this.requests.get(id);
    if (request.status !== "approved") throw new ToolRunnerError(`Tool request must be approved before execution; current status is ${request.status}.`, "blocked");
    const agentRequest = /^agent:(\d+):run:(\d+)$/.exec(request.requestedBy);
    if (agentRequest) {
      const store = new AgentStore(this.registry.database, key => this.registry.getToolByKey(key), key => !!getMemoryStore().getProjectByKey(key), this.registry.rootDir);
      const agent = store.get(Number(agentRequest[1]));
      const agentRun = store.getRun(Number(agentRequest[2]));
      if (agentRun.agentId !== agent.id || !agentRun.approvalsCreated.includes(id) || agentRun.status !== "waiting_approval") throw new ToolRunnerError("Agent request is no longer valid for this run.", "blocked");
      store.assertTool(agent, agentRun.projectKey, request.toolKey, request.args);
    }
    const tool = this.registry.requireTool(request.toolKey);
    assertExecutable(tool, true);
    const args = tool.toolKey === "browser.input" || tool.toolKey === "browser.select" ? { ...request.args, value: this.requests.browserInputPayload(id) ?? "" } : tool.toolKey === "browser.navigate" ? { ...request.args, url: this.requests.browserUrlPayload(id) ?? "" } : request.args;
    return this.execute(tool.toolKey, args, request.id, true);
  }

  private async execute(toolKey: string, args: JsonObject, requestId: number | null, approved: boolean): Promise<ToolRun> {
    if (isBrowserActionKey(toolKey) && (!approved || requestId === null)) throw new ToolRunnerError("Browser actions require an approved Tool Runner request.", "blocked");
    const tool = this.registry.requireTool(toolKey); assertExecutable(tool, approved || tool.riskLevel === "read_only");
    if (toolKey.startsWith("computer.")) {
      try { validateComputerArgs(toolKey, args); }
      catch (error) {
        this.registry.logEvent("tool.arguments.blocked", "Computer arguments rejected before audit persistence.", {toolKey, requestId});
        if (error instanceof ComputerError) throw new ToolRunnerError(error.message, error.code === "validation" ? "validation" : "blocked");
        throw error;
      }
    }
    const auditArgs = toolKey.startsWith("browser.") ? browserAuditArgs(toolKey, args) : toolKey === "coding.change.preview" ? { summary: args.summary, files: Array.isArray(args.files) ? args.files.map((file: any) => ({ path: file?.path, operation: file?.operation })) : [] } : computerAuditArgs(toolKey, args);
    const run = this.requests.startRun(toolKey, auditArgs, requestId);
    try {
      const output = isOperatorTool(toolKey) ? await executeOperatorTool(this.registry, toolKey, args) : await executeSafeTool(this.registry, toolKey, args, { requestId: requestId ?? undefined, toolRunId: run.id });
      const auditOutput = toolKey.startsWith("browser.") ? { redacted: true } : toolKey === "coding.file.read" || toolKey === "coding.search" || toolKey === "coding.git.diff" || toolKey === "coding.git.diff_file" || toolKey === "coding.change.preview" || toolKey === "coding.command.run" ? { redacted: true } : computerAuditOutput(toolKey, output);
      const finished = this.requests.finishRun(run.id, "completed", auditOutput, null);
      return { ...finished, output };
    }
    catch (error) { const message = error instanceof Error ? error.message : "Tool execution failed."; this.requests.finishRun(run.id, error instanceof ToolRunnerError && error.code === "blocked" ? "blocked" : "failed", null, message); throw error; }
  }
}

export const runReadOnlyTool = (toolKey: string, args?: JsonObject) => new ToolExecutor().runReadOnlyTool(toolKey, args);
export const runApprovedToolRequest = (id: number) => new ToolExecutor().runApprovedToolRequest(id);
