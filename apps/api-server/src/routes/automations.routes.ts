import { Router } from "express";
import { AutomationService, getToolRegistry, type CreateAutomationRuleInput, type JsonObject } from "@freeos/tool-runner";

export const automationsRouter = Router();
const service = () => new AutomationService(getToolRegistry());
const record = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

automationsRouter.get("/status", (_request, response, next) => { try { const db = getToolRegistry().database; response.json({ automationsEnabled: true, rulesCount: Number((db.prepare("SELECT COUNT(*) AS count FROM automation_rules").get() as { count: number }).count), enabledRulesCount: Number((db.prepare("SELECT COUNT(*) AS count FROM automation_rules WHERE enabled=1").get() as { count: number }).count), pendingApprovalCount: Number((db.prepare("SELECT COUNT(*) AS count FROM tool_requests WHERE status='pending' AND requested_by LIKE 'automation:%'").get() as { count: number }).count), dangerousActionsEnabled: false }); } catch (error) { next(error); } });
automationsRouter.get("/", (_request, response, next) => { try { response.json({ rules: service().listAutomationRules() }); } catch (error) { next(error); } });
automationsRouter.post("/", (request, response, next) => { try { const body = record(request.body); response.status(201).json({ rule: service().createAutomationRule({ ruleKey: String(body.ruleKey ?? ""), name: String(body.name ?? ""), description: typeof body.description === "string" ? body.description : undefined, enabled: body.enabled === true, triggerType: body.triggerType as CreateAutomationRuleInput["triggerType"], triggerConfig: record(body.triggerConfig), actionToolKey: String(body.actionToolKey ?? ""), actionArgs: record(body.actionArgs) }) }); } catch (error) { next(error); } });
automationsRouter.post("/:ruleKey/enable", (request, response, next) => { try { response.json({ rule: service().enableAutomationRule(request.params.ruleKey) }); } catch (error) { next(error); } });
automationsRouter.post("/:ruleKey/disable", (request, response, next) => { try { response.json({ rule: service().disableAutomationRule(request.params.ruleKey) }); } catch (error) { next(error); } });
automationsRouter.post("/:ruleKey/check", async (request, response, next) => { try { response.json(await service().runAutomationCheckOnce(request.params.ruleKey)); } catch (error) { next(error); } });
