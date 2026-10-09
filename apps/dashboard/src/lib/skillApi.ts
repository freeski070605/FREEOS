export type SkillRiskLevel = "standard" | "elevated" | "safety-critical";
export type SkillMasteryLevel = "theory" | "guided" | "practicing" | "working" | "proficient" | "advanced";

export interface SkillAcademyStatus {
  enabled: boolean;
  domains: number;
  competencies: number;
  activeTrainingUnits: number;
  draftTrainingUnits: number;
  activeDrills: number;
  practiceSessions: number;
  evaluatedSessions: number;
  advancedCompetencies: number;
  rule: string;
}

export interface SkillCompetency {
  id: number;
  competencyKey: string;
  domainKey: string;
  name: string;
  description: string;
  purpose: string;
  riskLevel: SkillRiskLevel;
  status: string;
  masteryLevel: SkillMasteryLevel;
  masteryScore: number;
  practiceCount: number;
  passedCount: number;
  activeUnits: number;
  activeDrills: number;
}

export interface SkillDomain {
  id: number;
  domainKey: string;
  name: string;
  description: string;
  riskProfile: SkillRiskLevel;
  status: string;
  competencies: SkillCompetency[];
}

export interface SkillPracticeSession {
  id: number;
  competencyKey: string;
  drillKey: string | null;
  resultSummary: string;
  evidence: string;
  score: number | null;
  humanReviewed: boolean;
  evaluator: string;
  evaluationNotes: string;
  status: string;
  createdAt: string;
  evaluatedAt: string | null;
}

type JsonRecord = Record<string, unknown>;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    throw new Error(typeof record.error === "string" ? record.error : `Request returned HTTP ${response.status}.`);
  }
  return payload;
}

export const skillApi = {
  status: async (): Promise<SkillAcademyStatus> => requestJson("/skill-academy/status") as Promise<SkillAcademyStatus>,
  catalog: async (domainKey?: string): Promise<SkillDomain[]> => {
    const query = domainKey ? `?domainKey=${encodeURIComponent(domainKey)}` : "";
    const payload = await requestJson(`/skill-academy/catalog${query}`);
    if (!isRecord(payload) || !Array.isArray(payload.domains)) return [];
    return payload.domains as SkillDomain[];
  },
  practice: async (limit = 50): Promise<SkillPracticeSession[]> => {
    const payload = await requestJson(`/skill-academy/practice?limit=${Math.max(1, Math.min(limit, 100))}`);
    if (!isRecord(payload) || !Array.isArray(payload.sessions)) return [];
    return payload.sessions as SkillPracticeSession[];
  },
  createPractice: async (input: { competencyKey: string; resultSummary: string; evidence?: string; drillKey?: string }) =>
    requestJson("/skill-academy/practice", { method: "POST", body: JSON.stringify(input) }) as Promise<{ session: SkillPracticeSession; masteryChanged: false }>,
  evaluatePractice: async (id: number, input: { score: number; humanReviewed: boolean; evaluator?: string; notes?: string }) =>
    requestJson(`/skill-academy/practice/${id}/evaluate`, { method: "POST", body: JSON.stringify(input) }),
};
