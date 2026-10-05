import type { MemoryProposal } from "./api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export type LearningScope = "global" | "project" | "client" | "business" | "personal";
export type LearningSensitivity = "public" | "internal" | "project-restricted" | "private";
export type LearningConfidence = "confirmed" | "high" | "moderate" | "low" | "unverified" | "disputed";

export interface LearningProposal extends MemoryProposal {
  proposedKnowledge: string;
  whyItMatters: string;
  scope: LearningScope;
  sensitivity: LearningSensitivity;
  confidence: LearningConfidence;
  noticed: string | null;
  userTags: string[];
}

export interface LearningProposalEdit {
  title?: string;
  noticed?: string;
  proposedKnowledge?: string;
  whyItMatters?: string;
  scope?: LearningScope;
  sensitivity?: LearningSensitivity;
  confidence?: LearningConfidence;
  category?: string;
  projectKey?: string;
  tags?: string[];
}

async function json(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `Learning request failed with HTTP ${response.status}.`);
  }
  return payload;
}

export const learningApi = {
  proposals: async (status: "pending" | "approved" | "rejected" = "pending"): Promise<LearningProposal[]> => {
    const payload = await json(`/learning/proposals?status=${status}`);
    return Array.isArray(payload.proposals) ? payload.proposals as LearningProposal[] : [];
  },
  revise: async (id: number, input: LearningProposalEdit): Promise<LearningProposal> => {
    const payload = await json(`/learning/proposals/${id}/revise`, { method: "POST", body: JSON.stringify(input) });
    return payload.proposal as LearningProposal;
  },
  approve: async (id: number) => json(`/learning/proposals/${id}/approve`, { method: "POST" }),
  reject: async (id: number) => json(`/learning/proposals/${id}/reject`, { method: "POST" }),
};
