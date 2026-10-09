import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "this",
  "to", "we", "what", "when", "where", "who", "why", "with", "you", "your",
]);

function db(): Database {
  return getToolRegistry().database;
}

function tableExists(database: Database, name: string): boolean {
  const row = database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

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

function score(queryTokens: string[], row: Row): number {
  const title = `${String(row.competency_name ?? "")} ${String(row.title ?? "")}`.toLowerCase();
  const tags = `${String(row.competency_key ?? "")} ${String(row.unit_type ?? "")} ${String(row.pack_title ?? "")}`.toLowerCase();
  const content = String(row.content ?? "").toLowerCase();
  let total = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) total += 6;
    if (tags.includes(token)) total += 4;
    if (content.includes(token)) total += 2;
  }
  return total;
}

export interface SkillTeachingContextItem {
  id: number;
  competencyKey: string;
  competencyName: string;
  unitType: string;
  title: string;
  content: string;
  confidence: string;
  masteryLevel: string;
  riskLevel: string;
  packKey: string;
  packTitle: string;
  relevance: number;
}

export function buildSkillTeachingContext(input: { query: string; limit?: number }) {
  const database = db();
  const query = input.query.trim();
  const queryTokens = tokens(query);
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30);

  if (!queryTokens.length || !["skill_units", "skill_competencies", "skill_teaching_packs"].every((name) => tableExists(database, name))) {
    return { context: "", items: [] as SkillTeachingContextItem[], query };
  }

  const rows = database.prepare(`
    SELECT
      su.id,
      su.competency_key,
      su.unit_type,
      su.title,
      su.content,
      su.confidence,
      su.pack_key,
      sc.name AS competency_name,
      sc.mastery_level,
      sc.risk_level,
      stp.title AS pack_title,
      stp.approval_status
    FROM skill_units su
    JOIN skill_competencies sc ON sc.competency_key=su.competency_key
    JOIN skill_teaching_packs stp ON stp.pack_key=su.pack_key
    WHERE su.status='active'
      AND sc.status='active'
      AND stp.approval_status='owner-approved'
  `).all() as Row[];

  const items = rows
    .map((row) => ({
      id: Number(row.id),
      competencyKey: String(row.competency_key),
      competencyName: String(row.competency_name),
      unitType: String(row.unit_type),
      title: String(row.title),
      content: String(row.content),
      confidence: String(row.confidence),
      masteryLevel: String(row.mastery_level),
      riskLevel: String(row.risk_level),
      packKey: String(row.pack_key),
      packTitle: String(row.pack_title),
      relevance: score(queryTokens, row),
    }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.competencyKey.localeCompare(b.competencyKey) || a.id - b.id)
    .slice(0, limit);

  if (!items.length) return { context: "", items, query };

  const lines = items.map((item) =>
    `- [competency=${item.competencyKey}; unit=${item.unitType}; confidence=${item.confidence}; mastery=${item.masteryLevel}; risk=${item.riskLevel}; pack=${item.packKey}] ${item.title}: ${item.content}`,
  );

  const context = [
    "OWNER-APPROVED PRACTICAL SKILL TRAINING",
    "Use these active Skill Academy units as procedural and judgment guidance when relevant. Training material is not proof of FREEOS mastery. Mastery level reports demonstrated practice state only. Safety-critical or elevated-risk skills still require appropriate human review and must not override FREEOS safety controls, canonical owner direction, or freshness-bounded Current Intelligence.",
    ...lines,
  ].join("\n");

  return { context, items, query };
}
