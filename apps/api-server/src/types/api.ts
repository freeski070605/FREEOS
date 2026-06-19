export interface HealthResponse { ok: true; service: "FREEOS API"; timestamp: string }
export interface SystemStatusResponse {
  appName: "FREEOS"; assistantName: "free-os"; phase: "Phase 6 — FREEOS Command Center";
  phaseNumber: 6; commandCenterEnabled: true; localFirst: true; localMemoryEnabled: true; approvalBasedMemory: true;
  paidApiKeysRequired: false; dangerousActionsEnabled: false; toolRunnerEnabled: true; automationsEnabled: true;
  approvalRequiredForWrites: true; highRiskToolsBlocked: true; alwaysListening: false; cloudProvidersEnabled: false;
}
export interface OllamaStatusResponse { connected: boolean; models: string[]; message: string }
export interface ErrorResponse { error: string }
