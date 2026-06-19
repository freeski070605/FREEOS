import type { SystemStatusResponse } from "../types/api";

export function getSystemStatus(): SystemStatusResponse {
  return {
    appName: "FREEOS", assistantName: "free-os", phase: "Phase 6 — FREEOS Command Center", phaseNumber: 6,
    commandCenterEnabled: true, localFirst: true, localMemoryEnabled: true, approvalBasedMemory: true,
    paidApiKeysRequired: false, dangerousActionsEnabled: false, toolRunnerEnabled: true, automationsEnabled: true,
    approvalRequiredForWrites: true, highRiskToolsBlocked: true, alwaysListening: false, cloudProvidersEnabled: false,
  };
}
