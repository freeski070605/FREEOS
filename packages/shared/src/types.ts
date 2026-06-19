export const FREEOS_PHASE = "Phase 2 — Local Memory + Project Knowledge" as const;

export interface CapabilityStatus {
  id: string;
  enabled: boolean;
  requiresApproval: boolean;
}
