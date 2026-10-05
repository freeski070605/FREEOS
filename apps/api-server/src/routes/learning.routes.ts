import { Router } from "express";
import {
  getMemoryStore,
  type MemoryCategory,
  type MemoryProposal,
  type ProposalStatus,
} from "@freeos/memory-core";
import { registerApprovedMemory } from "../services/knowledgeGovernance.service";

export const learningRouter = Router();

const store = () => getMemoryStore();

const proposalStatuses: ProposalStatus[] = ["pending", "approved", "rejected"];
const categories: MemoryCategory[] = [
  "general",
  "fact",
  "preference",
  "decision",
  "project",
  "reference",
  "research",
];

const sensitivities = [
  "public",
  "internal",
  "project-restricted",
  "private",
  "secret-credential",
] as const;

const confidences = [
  "confirmed",
  "high",
  "moderate",
  "low",
  "unverified",
  "disputed",
] as const;

const scopes = ["global", "project", "client", "business", "personal"] as const;

type Sensitivity = (typeof sensitivities)[number];
type Confidence = (typeof confidences)[number];
type LearningScope = (typeof scopes)[number];

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value as T[number])
    ? value as T[number]
    : fallback;
}

function tagValue(tags: string[], prefix: string): string | undefined {
  const match = tags.find((tag) => tag.startsWith(`${prefix}:`));
  return match?.slice(prefix.length + 1);
}

function withoutMetadataTags(tags: string[]): string[] {
  return tags.filter((tag) =>
    tag !== "learning-proposal" &&
    !tag.startsWith("scope:") &&
    !tag.startsWith("sensitivity:") &&
    !tag.startsWith("confidence:") &&
    !tag.startsWith("noticed:"),
  );
}

function metadataTags(input: {
  tags?: string[];
  scope: LearningScope;
  sensitivity: Sensitivity;
  confidence: Confidence;
  noticed?: string;
}): string[] {
  const tags = [
    "learning-proposal",
    `scope:${input.scope}`,
    `sensitivity:${input.sensitivity}`,
    `confidence:${input.confidence}`,
    ...withoutMetadataTags(input.tags ?? []),
  ];

  if (input.noticed) {
    const compact = input.noticed.replace(/\s+/g, " ").trim().slice(0, 120);
    if (compact) tags.push(`noticed:${compact}`);
  }

  return [...new Set(tags)];
}

function learningView(proposal: MemoryProposal) {
  const scope = oneOf(tagValue(proposal.tags, "scope"), scopes, proposal.projectKey ? "project" : "global");
  const sensitivity = oneOf(tagValue(proposal.tags, "sensitivity"), sensitivities, "internal");
  const confidence = oneOf(tagValue(proposal.tags, "confidence"), confidences, "moderate");
  const noticed = tagValue(proposal.tags, "noticed") ?? null;

  return {
    ...proposal,
    proposedKnowledge: proposal.content,
    whyItMatters: proposal.reason,
    scope,
    sensitivity,
    confidence,
    noticed,
    userTags: withoutMetadataTags(proposal.tags),
  };
}

function findProposal(id: number, status?: ProposalStatus): MemoryProposal | null {
  if (!Number.isInteger(id) || id < 1) return null;
  const statuses = status ? [status] : proposalStatuses;
  for (const itemStatus of statuses) {
    const found = store().listProposals(itemStatus).find((proposal) => proposal.id === id);
    if (found) return found;
  }
  return null;
}

function normalizeCreate(body: JsonRecord, existing?: MemoryProposal) {
  const projectKey = cleanString(body.projectKey) ?? existing?.projectKey ?? undefined;
  const category = oneOf(body.category, categories, existing?.category ?? (projectKey ? "project" : "general"));
  const scopeDefault: LearningScope = projectKey ? "project" : "global";
  const existingScope = existing ? oneOf(tagValue(existing.tags, "scope"), scopes, scopeDefault) : scopeDefault;
  const existingSensitivity = existing ? oneOf(tagValue(existing.tags, "sensitivity"), sensitivities, "internal") : "internal";
  const existingConfidence = existing ? oneOf(tagValue(existing.tags, "confidence"), confidences, "moderate") : "moderate";

  const scope = oneOf(body.scope, scopes, existingScope);
  const sensitivity = oneOf(body.sensitivity, sensitivities, existingSensitivity);
  const confidence = oneOf(body.confidence, confidences, existingConfidence);

  if (sensitivity === "secret-credential") {
    throw new Error("Raw credentials must not be stored as durable Learning Proposals. Store the secret in the credential store and propose only its purpose/location metadata.");
  }

  const proposedKnowledge = cleanString(body.proposedKnowledge)
    ?? cleanString(body.content)
    ?? existing?.content;
  if (!proposedKnowledge) throw new Error("proposedKnowledge is required.");

  const title = cleanString(body.title)
    ?? existing?.title
    ?? proposedKnowledge.slice(0, 80);
  const whyItMatters = cleanString(body.whyItMatters)
    ?? cleanString(body.reason)
    ?? existing?.reason
    ?? "Candidate durable learning requires owner review.";
  const noticed = cleanString(body.noticed)
    ?? (existing ? tagValue(existing.tags, "noticed") : undefined);
  const source = cleanString(body.source)
    ?? existing?.source
    ?? "learning-engine";
  const userTags = body.tags !== undefined
    ? stringList(body.tags)
    : existing ? withoutMetadataTags(existing.tags) : [];

  return {
    title,
    proposedKnowledge,
    whyItMatters,
    noticed,
    category,
    projectKey,
    source,
    tags: metadataTags({ tags: userTags, scope, sensitivity, confidence, noticed }),
    scope,
    sensitivity,
    confidence,
  };
}

learningRouter.get("/status", (_request, response, next) => {
  try {
    const memoryStatus = store().getMemoryStatus();
    response.json({
      enabled: true,
      durableLearningRequiresApproval: true,
      pending: memoryStatus.pendingProposals,
      rejected: memoryStatus.rejectedProposals,
      approvedMemories: memoryStatus.approvedMemories,
      sensitivities,
      confidences,
      scopes,
    });
  } catch (error) { next(error); }
});

learningRouter.get("/proposals", (request, response, next) => {
  try {
    const requested = cleanString(request.query.status) ?? "pending";
    if (!proposalStatuses.includes(requested as ProposalStatus)) {
      response.status(400).json({ error: "status must be pending, approved, or rejected." });
      return;
    }
    const proposals = store().listProposals(requested as ProposalStatus).map(learningView);
    response.json({ proposals });
  } catch (error) { next(error); }
});

learningRouter.post("/proposals", (request, response, next) => {
  try {
    const normalized = normalizeCreate(record(request.body));
    const proposal = store().createProposal({
      title: normalized.title,
      content: normalized.proposedKnowledge,
      category: normalized.category,
      projectKey: normalized.projectKey,
      source: normalized.source,
      tags: normalized.tags,
      reason: normalized.whyItMatters,
    });
    response.status(201).json({ proposal: learningView(proposal), durableMemoryCreated: false });
  } catch (error) {
    if (error instanceof Error && error.message.includes("credential")) {
      response.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message === "proposedKnowledge is required.") {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

learningRouter.post("/proposals/:id/revise", (request, response, next) => {
  try {
    const id = Number(request.params.id);
    const existing = findProposal(id, "pending");
    if (!existing) {
      response.status(404).json({ error: "Pending Learning Proposal not found." });
      return;
    }

    const normalized = normalizeCreate(record(request.body), existing);
    const rejected = store().rejectProposal(id);
    const revised = store().createProposal({
      title: normalized.title,
      content: normalized.proposedKnowledge,
      category: normalized.category,
      projectKey: normalized.projectKey,
      source: cleanString(record(request.body).source) ?? "owner-edit",
      tags: [...normalized.tags, `supersedes-proposal:${id}`],
      reason: normalized.whyItMatters,
    });

    response.status(201).json({
      superseded: learningView(rejected),
      proposal: learningView(revised),
      durableMemoryCreated: false,
    });
  } catch (error) { next(error); }
});

learningRouter.post("/proposals/:id/approve", (request, response, next) => {
  try {
    const result = store().approveProposal(Number(request.params.id));
    const governance = registerApprovedMemory(result.memory.id);
    response.json({
      proposal: learningView(result.proposal),
      memory: result.memory,
      governance,
      durableMemoryCreated: true,
    });
  } catch (error) { next(error); }
});

learningRouter.post("/proposals/:id/reject", (request, response, next) => {
  try {
    const proposal = store().rejectProposal(Number(request.params.id));
    response.json({ proposal: learningView(proposal), durableMemoryCreated: false });
  } catch (error) { next(error); }
});
