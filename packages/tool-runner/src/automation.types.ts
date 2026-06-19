import type { JsonObject } from "./tool.types";

export type AutomationTriggerType = "manual" | "interval_preview";

export interface AutomationRule {
  id: number;
  ruleKey: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: AutomationTriggerType;
  triggerConfig: JsonObject;
  actionToolKey: string;
  actionArgs: JsonObject;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationRuleInput {
  ruleKey: string;
  name: string;
  description?: string;
  enabled?: boolean;
  triggerType: AutomationTriggerType;
  triggerConfig?: JsonObject;
  actionToolKey: string;
  actionArgs?: JsonObject;
}
