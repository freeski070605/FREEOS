import { getOperatorStatus, inspectOperatorEnvironment, launchOperator, listOperators, runBlenderPlan, type OperatorKey } from "@freeos/operator-core";
import type { JsonObject, ToolDefinition, ToolRiskLevel } from "./tool.types";
import { ToolRunnerError } from "./tool.types";
import { getToolRegistry, type ToolRegistry } from "./toolRegistry";

const OPERATOR_TOOLS: Array<Omit<ToolDefinition, "id" | "createdAt" | "updatedAt">> = [
  { toolKey: "operator.apps.list", name: "List production operators", description: "Lists configured creative/development operators and readiness without launching anything.", category: "operator", riskLevel: "read_only" as ToolRiskLevel, enabled: true, requiresApproval: false },
  { toolKey: "operator.status", name: "Production operator status", description: "Checks one configured operator and its exact executable readiness.", category: "operator", riskLevel: "read_only" as ToolRiskLevel, enabled: true, requiresApproval: false },
  { toolKey: "operator.environment.inspect", name: "Inspect production environment", description: "Inventories the selected production operator and other configured operators. Blender inspection also inventories available/enabled addons so FREEOS can use existing tools before seeking new ones.", category: "operator", riskLevel: "read_only" as ToolRiskLevel, enabled: true, requiresApproval: false },
  { toolKey: "operator.app.launch", name: "Launch production application", description: "Launches one explicitly configured production application. Requires owner approval.", category: "operator", riskLevel: "medium_risk" as ToolRiskLevel, enabled: true, requiresApproval: true },
  { toolKey: "operator.blender.run_plan", name: "Run governed Blender plan", description: "Executes a validated JSON scene plan through FREEOS's fixed Blender driver. Arbitrary Python and shell execution are not accepted.", category: "operator", riskLevel: "medium_risk" as ToolRiskLevel, enabled: true, requiresApproval: true },
];

export function registerOperatorTools(registry: ToolRegistry = getToolRegistry()): ToolDefinition[] {
  const statement = registry.database.prepare(`INSERT INTO tool_registry (tool_key,name,description,category,risk_level,enabled,requires_approval)
    VALUES (@toolKey,@name,@description,@category,@riskLevel,@enabled,@requiresApproval)
    ON CONFLICT(tool_key) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,risk_level=excluded.risk_level,enabled=excluded.enabled,requires_approval=excluded.requires_approval,updated_at=CURRENT_TIMESTAMP`);
  registry.database.transaction(() => {
    for (const tool of OPERATOR_TOOLS) statement.run({ ...tool, enabled: Number(tool.enabled), requiresApproval: Number(tool.requiresApproval) });
  })();
  registry.logEvent("operators.registered", "Production operator tools registered.", { count: OPERATOR_TOOLS.length });
  return OPERATOR_TOOLS.map(tool => registry.requireTool(tool.toolKey));
}

function operatorKey(value: unknown): OperatorKey {
  if (typeof value !== "string" || !value.trim()) throw new ToolRunnerError("operatorKey is required.", "validation");
  const key = value.trim() as OperatorKey;
  try { getOperatorStatus(key); return key; }
  catch (error) { throw new ToolRunnerError(error instanceof Error ? error.message : "Unknown operator.", "validation"); }
}

export async function executeOperatorTool(registry: ToolRegistry, toolKey: string, args: JsonObject): Promise<unknown> {
  try {
    switch (toolKey) {
      case "operator.apps.list": return { operators: listOperators() };
      case "operator.status": return { operator: getOperatorStatus(operatorKey(args.operatorKey)) };
      case "operator.environment.inspect": return { inventory: await inspectOperatorEnvironment(operatorKey(args.operatorKey)) };
      case "operator.app.launch": return await launchOperator(operatorKey(args.operatorKey));
      case "operator.blender.run_plan": {
        const path = typeof args.planPath === "string" ? args.planPath.trim() : "";
        if (!path) throw new ToolRunnerError("planPath is required.", "validation");
        return await runBlenderPlan(registry.rootDir, path);
      }
      default: throw new ToolRunnerError(`Unknown operator tool: ${toolKey}.`, "not_found");
    }
  } catch (error) {
    if (error instanceof ToolRunnerError) throw error;
    throw new ToolRunnerError(error instanceof Error ? error.message : "Operator action failed.", "blocked");
  }
}

export function isOperatorTool(toolKey: string): boolean { return toolKey.startsWith("operator."); }
