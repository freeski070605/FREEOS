import { getMemoryStore } from "@freeos/memory-core";
import {
  knowledgeDb,
  registerApprovedMemory,
  upsertKnowledgeRecord,
} from "./knowledgeGovernance.service";
import { buildSkillTeachingContext } from "./skillTeachingContext.service";

type Row = Record<string, unknown>;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "this",
  "to", "we", "what", "when", "where", "who", "why", "with", "you", "your",
]);

function tokens(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9&'\s-]/g, " ")
      .replace(/[-_]+/g, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && !STOPWORDS.has(item)),
  ));
}

function relevance(queryTokens: string[], title: string, content: string, tags: string): number {
  if (queryTokens.length === 0) return 0;
  const titleText = title.toLowerCase();
  const contentText = content.toLowerCase();
  const tagsText = tags.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (titleText.includes(token)) score += 5;
    if (tagsText.includes(token)) score += 3;
    if (contentText.includes(token)) score += 2;
  }
  return score;
}

function tableExists(name: string): boolean {
  const row = knowledgeDb().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

function ensureGovernedLocalSources(projectKey?: string): void {
  const store = getMemoryStore();
  for (const memory of store.listApprovedMemories({ limit: 500 })) {
    registerApprovedMemory(memory.id);
  }

  if (!projectKey) return;
  const db = knowledgeDb();
  const notes = db.prepare("SELECT * FROM project_notes WHERE project_key = ? ORDER BY id").all(projectKey) as Row[];
  for (const note of notes) {
    upsertKnowledgeRecord({
      sourceType: "project-note",
      sourceRef: `project-note:${Number(note.id)}`,
      projectKey,
      title: String(note.title),
      authority: "unapproved-draft",
      confidence: "moderate",
      sensitivity: "project-restricted",
      provenance: `Project note #${Number(note.id)}; source=${String(note.source ?? "manual")}`,
      effectiveAt: String(note.created_at),
      verifiedAt: String(note.updated_at),
    });
  }
}

export interface GovernedLocalContextOptions {
  query: string;
  projectKey?: string;
  includeMemory?: boolean;
  includeProjectNotes?: boolean;
  limit?: number;
}

export interface GovernedLocalItem {
  kind: "memory" | "project-note" | "project-baseline";
  id: number;
  title: string;
  content: string;
  projectKey: string | null;
  authority: string;
  authorityRank: number;
  status: string;
  confidence: string;
  relevance: number;
}

export function buildGovernedLocalContext(options: GovernedLocalContextOptions) {
  const query = options.query.trim();
  const projectKey = options.projectKey?.trim() || undefined;
  const includeMemory = options.includeMemory !== false;
  const includeProjectNotes = options.includeProjectNotes !== false;
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
  const queryTokens = tokens(query);
  const skillTraining = buildSkillTeachingContext({ query, limit });

  ensureGovernedLocalSources(projectKey);
  const db = knowledgeDb();
  const candidates: GovernedLocalItem[] = [];

  if (includeMemory && queryTokens.length > 0) {
    const rows = db.prepare(`
      SELECT
        m.id, m.title, m.content, m.tags, m.project_key,
        kr.authority, kr.authority_rank, kr.status, kr.confidence
      FROM memories m
      JOIN knowledge_records kr
        ON kr.source_type = 'approved-memory'
       AND kr.source_ref = ('memory:' || m.id)
      WHERE m.status = 'approved'
        AND kr.status = 'active'
        AND (? IS NULL OR m.project_key IS NULL OR m.project_key = ?)
    `).all(projectKey ?? null, projectKey ?? null) as Row[];

    for (const row of rows) {
      const score = relevance(queryTokens, String(row.title), String(row.content), String(row.tags ?? ""));
      if (score <= 0) continue;
      candidates.push({
        kind: "memory",
        id: Number(row.id),
        title: String(row.title),
        content: String(row.content),
        projectKey: row.project_key == null ? null : String(row.project_key),
        authority: String(row.authority),
        authorityRank: Number(row.authority_rank),
        status: String(row.status),
        confidence: String(row.confidence),
        relevance: score,
      });
    }
  }

  if (projectKey && queryTokens.length > 0 && tableExists("project_baseline_reviews")) {
    const rows = db.prepare(`
      SELECT
        pbr.id,
        (p.name || ' canonical project baseline') AS title,
        pbr.baseline_text AS content,
        pbr.project_key,
        kr.authority, kr.authority_rank, kr.status, kr.confidence
      FROM project_baseline_reviews pbr
      JOIN projects p ON p.project_key = pbr.project_key
      JOIN knowledge_records kr
        ON kr.source_type = 'project-canonical-baseline'
       AND kr.source_ref = ('project-baseline-review:' || pbr.id)
      WHERE pbr.project_key = ?
        AND pbr.status = 'approved'
        AND kr.status = 'active'
    `).all(projectKey) as Row[];

    for (const row of rows) {
      const score = relevance(queryTokens, String(row.title), String(row.content), "canonical project baseline");
      if (score <= 0) continue;
      candidates.push({
        kind: "project-baseline",
        id: Number(row.id),
        title: String(row.title),
        content: String(row.content),
        projectKey: String(row.project_key),
        authority: String(row.authority),
        authorityRank: Number(row.authority_rank),
        status: String(row.status),
        confidence: String(row.confidence),
        relevance: score,
      });
    }
  }

  if (includeProjectNotes && projectKey && queryTokens.length > 0) {
    const rows = db.prepare(`
      SELECT
        pn.id, pn.title, pn.content, pn.tags, pn.project_key,
        kr.authority, kr.authority_rank, kr.status, kr.confidence
      FROM project_notes pn
      JOIN knowledge_records kr
        ON kr.source_type = 'project-note'
       AND kr.source_ref = ('project-note:' || pn.id)
      WHERE pn.project_key = ?
        AND kr.status = 'active'
    `).all(projectKey) as Row[];

    for (const row of rows) {
      const score = relevance(queryTokens, String(row.title), String(row.content), String(row.tags ?? ""));
      if (score <= 0) continue;
      candidates.push({
        kind: "project-note",
        id: Number(row.id),
        title: String(row.title),
        content: String(row.content),
        projectKey: String(row.project_key),
        authority: String(row.authority),
        authorityRank: Number(row.authority_rank),
        status: String(row.status),
        confidence: String(row.confidence),
        relevance: score,
      });
    }
  }

  const kindRank = (kind: GovernedLocalItem["kind"]): number => kind === "project-baseline" ? 0 : kind === "memory" ? 1 : 2;
  const items = candidates
    .sort((a, b) =>
      b.relevance - a.relevance ||
      b.authorityRank - a.authorityRank ||
      kindRank(a.kind) - kindRank(b.kind),
    )
    .slice(0, limit);

  const governedContext = items.length === 0
    ? ""
    : [
        "GOVERNED LOCAL KNOWLEDGE",
        "Only ACTIVE governed local records are included. Higher authority wins on conflict. Approved project baselines are canonical project knowledge. Project notes marked DRAFT-NOT-CONTROLLING may inform work but must not override owner instructions, canonical knowledge, or approved memory.",
        ...items.map((item) => {
          const draftWarning = item.authority === "unapproved-draft" ? "; DRAFT-NOT-CONTROLLING" : "";
          return `- [${item.kind}; authority=${item.authority}(${item.authorityRank}); confidence=${item.confidence}${draftWarning}] ${item.title}: ${item.content}`;
        }),
      ].join("\n");

  const context = [governedContext, skillTraining.context].filter(Boolean).join("\n\n");

  return {
    context,
    items,
    skillItems: skillTraining.items,
    query,
    projectKey: projectKey ?? null,
  };
}
