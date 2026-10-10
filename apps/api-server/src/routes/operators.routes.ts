import { Router } from "express";
import { getOperatorStatus, inspectOperatorEnvironment, listOperators, type OperatorKey } from "@freeos/operator-core";
import { getToolRegistry, ToolRequests } from "@freeos/tool-runner";

export const operatorsRouter = Router();
const body = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const key = (value: unknown): OperatorKey => {
  if (typeof value !== "string" || !value.trim()) throw new Error("operatorKey is required.");
  const result = value.trim() as OperatorKey;
  getOperatorStatus(result);
  return result;
};

operatorsRouter.get("/", (_request, response, next) => {
  try { response.json({ operators: listOperators() }); } catch (error) { next(error); }
});

operatorsRouter.get("/:key", (request, response, next) => {
  try { response.json({ operator: getOperatorStatus(key(request.params.key)) }); } catch (error) { next(error); }
});

operatorsRouter.get("/:key/environment", async (request, response, next) => {
  try { response.json({ inventory: await inspectOperatorEnvironment(key(request.params.key)) }); } catch (error) { next(error); }
});

operatorsRouter.post("/:key/launch-request", (request, response, next) => {
  try {
    const operatorKey = key(request.params.key);
    const item = getOperatorStatus(operatorKey);
    const requestItem = new ToolRequests(getToolRegistry()).createToolRequest({
      toolKey: "operator.app.launch",
      title: `Launch ${item.name}`,
      description: `Owner-reviewed launch request for ${item.name}.`,
      args: { operatorKey },
      requestedBy: "operators-api",
    });
    response.status(201).json({ request: requestItem });
  } catch (error) { next(error); }
});

operatorsRouter.post("/blender/plan-request", (request, response, next) => {
  try {
    const input = body(request.body);
    const planPath = typeof input.planPath === "string" ? input.planPath.trim() : "";
    if (!planPath) { response.status(400).json({ error: "planPath is required." }); return; }
    const requestItem = new ToolRequests(getToolRegistry()).createToolRequest({
      toolKey: "operator.blender.run_plan",
      title: "Run governed Blender plan",
      description: "Runs a structured Blender plan through the fixed FREEOS driver. Arbitrary Python is not accepted.",
      args: { planPath },
      requestedBy: "operators-api",
    });
    response.status(201).json({ request: requestItem });
  } catch (error) { next(error); }
});
