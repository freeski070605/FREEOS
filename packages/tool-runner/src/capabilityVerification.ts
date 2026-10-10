import { getToolRegistry } from "./toolRegistry";

export interface CapabilityVerification {
  capabilityKey: string;
  operatorKey: string;
  toolName: string;
  toolVersion: string;
  hostVersion: string;
  verificationKind: string;
  evidence: Record<string, unknown>;
  verifiedAt: string;
  updatedAt: string;
}

function ensureSchema(): void {
  getToolRegistry().database.exec(`
    CREATE TABLE IF NOT EXISTS capability_verifications (
      capability_key TEXT PRIMARY KEY,
      operator_key TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_version TEXT NOT NULL DEFAULT '',
      host_version TEXT NOT NULL DEFAULT '',
      verification_kind TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_capability_verifications_operator ON capability_verifications(operator_key, updated_at DESC);
  `);
}

function row(value: any): CapabilityVerification {
  let evidence: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(value.evidence_json ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) evidence = parsed as Record<string, unknown>;
  } catch { /* keep empty evidence */ }
  return {
    capabilityKey: String(value.capability_key),
    operatorKey: String(value.operator_key),
    toolName: String(value.tool_name),
    toolVersion: String(value.tool_version ?? ""),
    hostVersion: String(value.host_version ?? ""),
    verificationKind: String(value.verification_kind),
    evidence,
    verifiedAt: String(value.verified_at),
    updatedAt: String(value.updated_at),
  };
}

export function recordCapabilityVerification(input: {
  capabilityKey: string;
  operatorKey: string;
  toolName: string;
  toolVersion?: string;
  hostVersion?: string;
  verificationKind: string;
  evidence?: Record<string, unknown>;
}): CapabilityVerification {
  ensureSchema();
  const registry = getToolRegistry();
  registry.database.prepare(`
    INSERT INTO capability_verifications(capability_key,operator_key,tool_name,tool_version,host_version,verification_kind,evidence_json,verified_at,updated_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(capability_key) DO UPDATE SET
      operator_key=excluded.operator_key,
      tool_name=excluded.tool_name,
      tool_version=excluded.tool_version,
      host_version=excluded.host_version,
      verification_kind=excluded.verification_kind,
      evidence_json=excluded.evidence_json,
      verified_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    input.capabilityKey,
    input.operatorKey,
    input.toolName,
    input.toolVersion ?? "",
    input.hostVersion ?? "",
    input.verificationKind,
    JSON.stringify(input.evidence ?? {}),
  );
  registry.logEvent("capability.verified", `Verified capability: ${input.capabilityKey}`, {
    operatorKey: input.operatorKey,
    toolName: input.toolName,
    verificationKind: input.verificationKind,
  });
  const value = registry.database.prepare("SELECT * FROM capability_verifications WHERE capability_key=?").get(input.capabilityKey);
  return row(value);
}

export function getCapabilityVerification(capabilityKey: string): CapabilityVerification | null {
  ensureSchema();
  const value = getToolRegistry().database.prepare("SELECT * FROM capability_verifications WHERE capability_key=?").get(capabilityKey);
  return value ? row(value) : null;
}

export function listCapabilityVerifications(operatorKey?: string): CapabilityVerification[] {
  ensureSchema();
  const database = getToolRegistry().database;
  const values = operatorKey
    ? database.prepare("SELECT * FROM capability_verifications WHERE operator_key=? ORDER BY updated_at DESC").all(operatorKey)
    : database.prepare("SELECT * FROM capability_verifications ORDER BY updated_at DESC").all();
  return (values as any[]).map(row);
}
