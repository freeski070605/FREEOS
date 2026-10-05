import type { NextFunction, Request, Response } from "express";
import { getMemoryStore, type MemoryCategory } from "@freeos/memory-core";

const explicitRemember = /\bremember\s+(?:that\s+)?(.+)/is;
const sensitiveSecret = /\b(password|passcode|api[- ]?key|private[- ]?key|recovery[- ]?(?:code|phrase)|seed[- ]?phrase|access[- ]?token|refresh[- ]?token|secret[- ]?key)\b/i;

type Candidate = {
  title: string;
  content: string;
  category: MemoryCategory;
  reason: string;
  confidence: "high" | "moderate";
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function titleFor(prefix: string, content: string): string {
  const clean = compact(content).replace(/[.!?]+$/, "");
  return `${prefix}: ${clean}`.slice(0, 80);
}

function detect(message: string): Candidate | null {
  const text = compact(message);
  if (text.length < 8 || text.length > 1_200) return null;
  if (sensitiveSecret.test(text)) return null;
  if (explicitRemember.test(text)) return null; // Existing command-chat path already proposes these.

  let match = text.match(/\bkeep in mind(?: that)?\s+(.+)/i);
  if (match?.[1]) {
    const content = compact(match[1]);
    return {
      title: titleFor("Owner context", content),
      content,
      category: "preference",
      reason: "Drew explicitly marked this as context worth keeping in mind. Durable storage still requires approval.",
      confidence: "high",
    };
  }

  match = text.match(/\bfrom now on[, ]+(.+)/i);
  if (match?.[1]) {
    const content = compact(match[1]);
    return {
      title: titleFor("Standing direction", content),
      content,
      category: "decision",
      reason: "The message contains a forward-looking standing direction that may affect future behavior.",
      confidence: "high",
    };
  }

  match = text.match(/\b(?:going forward|moving forward)[, ]+(.+)/i);
  if (match?.[1]) {
    const content = compact(match[1]);
    return {
      title: titleFor("Standing direction", content),
      content,
      category: "decision",
      reason: "The message appears to define how FREEOS or DFB should operate in future work.",
      confidence: "high",
    };
  }

  match = text.match(/\bi prefer\s+(.+)/i);
  if (match?.[1]) {
    const preference = compact(match[1]);
    const content = `Drew prefers ${preference.replace(/[.!?]+$/, "")}.`;
    return {
      title: titleFor("Owner preference", preference),
      content,
      category: "preference",
      reason: "The owner directly stated a preference that may improve future responses or execution.",
      confidence: "high",
    };
  }

  match = text.match(/\bi (?:do not|don't) want\s+(.+)/i);
  if (match?.[1]) {
    const preference = compact(match[1]);
    const content = `Drew does not want ${preference.replace(/[.!?]+$/, "")}.`;
    return {
      title: titleFor("Owner preference", `Avoid ${preference}`),
      content,
      category: "preference",
      reason: "The owner directly stated a negative preference that may prevent repeated friction.",
      confidence: "high",
    };
  }

  match = text.match(/\bwe (?:decided|agreed)(?: that)?\s+(.+)/i);
  if (match?.[1]) {
    const decision = compact(match[1]);
    return {
      title: titleFor("Decision", decision),
      content: decision,
      category: "decision",
      reason: "The message explicitly describes a decision or agreement that may need to persist across future work.",
      confidence: "high",
    };
  }

  match = text.match(/\b(?:lock this|this is locked|lock that|make this canonical)\b[:,-]?\s*(.*)/i);
  if (match) {
    const decision = compact(match[1] || text);
    return {
      title: titleFor("Locked direction", decision),
      content: decision,
      category: "decision",
      reason: "The owner used explicit lock/canonical language, indicating likely durable project or operating knowledge.",
      confidence: "high",
    };
  }

  // Corrections are valuable but intentionally narrower than general disagreement.
  // Require a clear reference to FREEOS/DFB behavior so casual conversation does not
  // flood the approval queue.
  if (/\b(?:freeos|free-os|you)\b/i.test(text) && /\b(?:don't|do not|stop|instead|not supposed to|should always|should never)\b/i.test(text)) {
    return {
      title: titleFor("Candidate correction", text),
      content: text,
      category: "preference",
      reason: "The message may contain an owner correction about assistant/system behavior. Review before making it durable.",
      confidence: "moderate",
    };
  }

  return null;
}

export function learningCandidateMiddleware(request: Request, _response: Response, next: NextFunction) {
  try {
    if (request.method !== "POST" || request.path !== "/chat") {
      next();
      return;
    }

    const body = typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    if (body.skipLearningProposal === true) {
      next();
      return;
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const candidate = detect(message);
    if (!candidate) {
      next();
      return;
    }

    const projectKey = typeof body.projectKey === "string" && body.projectKey.trim()
      ? body.projectKey.trim()
      : undefined;
    const store = getMemoryStore();

    const duplicatePending = store.listProposals("pending").some((proposal) =>
      proposal.content.trim().toLowerCase() === candidate.content.trim().toLowerCase() &&
      (proposal.projectKey ?? undefined) === projectKey,
    );
    const duplicateApproved = store.listApprovedMemories({ q: candidate.content.slice(0, 120), projectKey, limit: 25 }).some((memory) =>
      memory.content.trim().toLowerCase() === candidate.content.trim().toLowerCase(),
    );

    if (!duplicatePending && !duplicateApproved) {
      const scope = projectKey ? "project" : "global";
      store.createProposal({
        title: candidate.title,
        content: candidate.content,
        category: projectKey ? "project" : candidate.category,
        projectKey,
        source: "learning-auto-detect",
        reason: candidate.reason,
        tags: [
          "learning-proposal",
          `scope:${scope}`,
          "sensitivity:internal",
          `confidence:${candidate.confidence}`,
          `noticed:${message.replace(/\s+/g, " ").slice(0, 120)}`,
          "auto-detected",
        ],
      });
    }
  } catch (error) {
    // Learning is supportive, never a reason to break the user's primary command.
    console.warn("[FREEOS] Learning candidate detection failed without blocking chat:", error);
  }

  next();
}
