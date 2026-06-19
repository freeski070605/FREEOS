import type { SystemStatusResponse } from "../types/api";
import { config } from "../config";

export function getSystemStatus(): SystemStatusResponse {
  return {
    appName: "FREEOS", assistantName: "free-os", version: config.version, releaseName: config.releaseName,
    phase: "Phase 6 — FREEOS Command Center", phaseNumber: config.phaseNumber, isStableRelease: true,
    commandCenterEnabled: true, localFirst: true, localMemoryEnabled: true, approvalBasedMemory: true,
    paidApiKeysRequired: false, dangerousActionsEnabled: false, toolRunnerEnabled: true, automationsEnabled: true,
    approvalRequiredForWrites: true, highRiskToolsBlocked: true, alwaysListening: false, cloudProvidersEnabled: false,
  };
}
