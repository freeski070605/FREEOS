import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

const projectAliases: Record<string, string[]> = {
  "client-builds": ["Client Builds", "Client / partner builds", "Client/partner builds", "Client and partner builds"],
  "business-ideas": ["Business Ideas", "Business Ideas / incubation"],
  "dfb-transportation": ["DFB Transportation"],
  "dfb-sounds": ["DFB Sounds", "Drew Free / DFB Sounds"],
  "still-raising-drew": ["Still Raising Drew"],
  "get-ya-5": ["Get Ya 5"],
};

const ownershipGroups: Array<[string, string]> = [
  ["Shared infrastructure", "DFB internal shared infrastructure"],
  ["Owned IP / brands", "DFB-owned IP / brand"],
  ["Service/cash-flow businesses", "DFB service/cash-flow business"],
  ["Client / partner builds", "client / partner build; ownership not assumed"],
  ["Business Ideas / incubation", "DFB incubation / exploratory opportunity"],
];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS project_inspection_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL UNIQUE,
        learning_work_id INTEGER,
        queue_item_id INTEGER,
        evidence_json TEXT NOT NULL,
        unknowns_json TEXT NOT NULL,
        baseline_draft TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'prepared',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_project_inspection_status ON project_inspection_drafts(status);
      CREATE INDEX IF NOT EXISTS idx_project_inspection_work ON project_inspection_drafts(learning_work_id);
    `);
    schemaReady = true;
  }
  return database;
}

function tableExists(database: Database, name: string): boolean {
  const row = database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

function rows(database: Database, sql: string, ...params: unknown[]): Row[] {
  return database.prepare(sql).all(...params) as Row[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasesFor(projectKey: string, projectName: string): string[] {
  const aliases = [projectName, ...(projectAliases[projectKey] ?? [])]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(aliases)];
}

function firstAliasInContent(content: string, aliases: string[]): string | null {
  const lower = content.toLowerCase();
  return aliases.find((alias) => lower.includes(alias.toLowerCase())) ?? null;
}

function excerptAround(content: string, needles: string[], radius = 700): string | null {
  const lower = content.toLowerCase();
  let bestIndex = -1;
  for (const needle of needles) {
    const index = lower.indexOf(needle.toLowerCase());
    if (index >= 0 && (bestIndex < 0 || index < bestIndex)) bestIndex = index;
  }
  if (bestIndex < 0) return null;
  const start = Math.max(0, bestIndex - Math.floor(radius / 3));
  const end = Math.min(content.length, bestIndex + radius);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function extractDirection(content: string, aliases: string[]): string | null {
  for (const alias of aliases) {
    const pattern = new RegExp(`###\\s+${escapeRegex(alias)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, "i");
    const match = content.match(pattern);
    if (match?.[1]?.trim()) return match[1].replace(/\s+/g, " ").trim().slice(0, 1600);
  }
  return null;
}

function organizationMapSection(content: string): string | null {
  const match = content.match(/##\s+DFB organization map\s*\n([\s\S]*?)(?=\n##\s+|$)/i);
  return match?.[1] ?? null;
}

function classifyOwnership(content: string, aliases: string[]): string | null {
  const organizationMap = organizationMapSection(content);
  if (organizationMap) {
    let currentClassification: string | null = null;
    for (const rawLine of organizationMap.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      for (const [heading, classification] of ownershipGroups) {
        if (line.toLowerCase().includes(heading.toLowerCase())) {
          currentClassification = classification;
          break;
        }
      }

      if (aliases.some((alias) => line.toLowerCase().includes(alias.toLowerCase()))) {
        return currentClassification;
      }
    }
  }

  // Fallback only when the canonical organization map is unavailable. Require
  // the category label and project alias to be very close so one portfolio
  // section cannot bleed into another.
  let best: { classification: string; distance: number } | null = null;
  const lower = content.toLowerCase();
  for (const [heading, classification] of ownershipGroups) {
    const headingLower = heading.toLowerCase();
    let headingIndex = lower.indexOf(headingLower);
    while (headingIndex >= 0) {
      for (const alias of aliases) {
        const aliasLower = alias.toLowerCase();
        let aliasIndex = lower.indexOf(aliasLower, headingIndex);
        while (aliasIndex >= 0 && aliasIndex - headingIndex <= 500) {
          const distance = aliasIndex - headingIndex;
          if (!best || distance < best.distance) best = { classification, distance };
          aliasIndex = lower.indexOf(aliasLower, aliasIndex + 1);
        }
      }
      headingIndex = lower.indexOf(headingLower, headingIndex + 1);
    }
  }
  return best?.classification ?? null;
}

function mapDraft(row: Row) {
  let evidence: Record<string, unknown> = {};
  let unresolvedUnknowns: string[] = [];
  try { evidence = JSON.parse(String(row.evidence_json ?? "{}")) as Record<string, unknown>; } catch { evidence = {}; }
  try {
    const parsed = JSON.parse(String(row.unknowns_json ?? "[]"));
    unresolvedUnknowns = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { unresolvedUnknowns = []; }
  return {
    id: Number(row.id),
    projectKey: String(row.project_key),
    learningWorkId: row.learning_work_id == null ? null : Number(row.learning_work_id),
    queueItemId: row.queue_item_id == null ? null : Number(row.queue_item_id),
    evidence,
    unresolvedUnknowns,
    baselineDraft: String(row.baseline_draft),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function inspectStableBaseline(projectKey: string) {
  const database = db();
  const project = database.prepare("SELECT * FROM projects WHERE project_key=?").get(projectKey) as Row | undefined;
  if (!project) throw new Error(`Project not found: ${projectKey}.`);

  const projectName = String(project.name);
  const description = String(project.description ?? "").trim();
  const aliases = aliasesFor(projectKey, projectName);

  if (!["knowledge_baselines", "knowledge_records", "rag_documents", "rag_chunks"].every((name) => tableExists(database, name))) {
    throw new Error("Knowledge Governance and governed RAG must be initialized before stable baseline inspection.");
  }

  const baselineDocs = rows(database, `
    SELECT kb.role,
           kr.id AS knowledge_record_id,
           kr.title AS knowledge_title,
           kr.authority,
           kr.authority_rank,
           kr.confidence,
           d.id AS document_id,
           d.file_name,
           d.file_path
    FROM knowledge_baselines kb
    JOIN knowledge_records kr ON kr.id=kb.knowledge_record_id
    JOIN rag_documents d ON d.file_path=kr.source_ref
    WHERE kb.project_key=?
      AND kr.status='active'
      AND kr.source_type='rag-document'
      AND kr.authority_rank>=85
      AND d.status='indexed'
    ORDER BY kr.authority_rank DESC,CASE kb.role WHEN 'canonical' THEN 0 ELSE 1 END,kr.id
  `, projectKey);

  const support: Record<string, unknown>[] = [];
  let ownershipClassification: string | null = /\bDFB[- ]owned\b/i.test(description) ? "DFB-owned" : null;
  let directionExcerpt: string | null = null;
  let directionRecordId: number | null = null;

  for (const doc of baselineDocs) {
    const chunks = rows(database, "SELECT content FROM rag_chunks WHERE document_id=? ORDER BY chunk_index", Number(doc.document_id));
    const content = chunks.map((row) => String(row.content ?? "")).join("\n");
    const matchedAlias = firstAliasInContent(content, aliases);
    if (!matchedAlias && !content.toLowerCase().includes(projectKey.toLowerCase())) continue;

    if (!ownershipClassification) ownershipClassification = classifyOwnership(content, aliases);
    if (!directionExcerpt) {
      const direction = extractDirection(content, aliases);
      if (direction) {
        directionExcerpt = direction;
        directionRecordId = Number(doc.knowledge_record_id);
      }
    }

    support.push({
      knowledgeRecordId: Number(doc.knowledge_record_id),
      title: String(doc.knowledge_title),
      role: String(doc.role),
      authority: String(doc.authority),
      authorityRank: Number(doc.authority_rank),
      confidence: String(doc.confidence),
      fileName: String(doc.file_name),
      matchedAlias,
      excerpt: excerptAround(content, aliases),
    });
  }

  const unknowns: string[] = [];
  if (!ownershipClassification) unknowns.push("Ownership / organizational classification is not established by active controlling evidence.");
  if (!directionExcerpt) unknowns.push("Owner-approved stable project direction (identity, scope, goals, constraints, or ownership boundaries) is not established by active controlling evidence.");
  if (support.length === 0) unknowns.push("No active approved-canonical supporting document explicitly supports this project baseline.");

  const advisories = [
    "This is a stable governance baseline. It does not claim current runtime, repository, delivery, or operational health.",
    "A local project source root is optional for this baseline mode; source-backed evidence should be added separately when it materially improves project knowledge.",
    "Fresh Current Intelligence remains the channel for time-sensitive state and should not be frozen into durable canonical identity without a specific reason.",
  ];

  const supportLines = support.length
    ? support.map((item) => `- ${String(item.title)} [${String(item.authority)}/${String(item.confidence)}; role=${String(item.role)}]${item.excerpt ? `: ${String(item.excerpt)}` : ""}`)
    : ["- No qualifying approved-canonical support found."];

  const lines = [
    `# ${projectName} — STABLE PROJECT BASELINE DRAFT`,
    "",
    "> DRAFT — NOT CANONICAL. This draft captures stable identity, scope, ownership boundaries, and owner-approved direction from controlling governed evidence. Dynamic current state is intentionally excluded.",
    "",
    "## Identity / Scope",
    description ? `- Registry description: ${description}` : "- Registry description: UNKNOWN",
    `- Project key: ${projectKey}`,
    `- Registry status: ${String(project.status)}`,
    `- Organizational / ownership classification: ${ownershipClassification ?? "UNKNOWN"}`,
    "",
    "## Controlling Supporting Context",
    ...supportLines,
    "",
    "## Stable Owner Direction",
    directionExcerpt ? `- Approved supporting context: ${directionExcerpt}` : "- UNKNOWN — no qualifying approved section establishes stable owner direction.",
    "",
    "## Dynamic Current State",
    "- Not canonicalized in this baseline. Current operational state belongs in freshness-bounded Current Intelligence or a separate source-backed inspection.",
    "",
    "## Advisories (Non-blocking)",
    ...advisories.map((item) => `- ${item}`),
    "",
    "## Unresolved Semantic UNKNOWNs",
    ...(unknowns.length ? unknowns.map((item) => `- ${item}`) : ["- None identified by the deterministic stable-baseline inspector."]),
    "",
    "## Recommended Next Step",
    unknowns.length === 0
      ? "- Stable semantic evidence gaps are resolved. Prepare this baseline for explicit owner review; canonicalization still requires Drew's approval."
      : "- Resolve only the remaining stable semantic evidence gaps before owner review. Do not invent a repository or live-state requirement for a governance/portfolio baseline.",
  ];

  return {
    project,
    evidence: {
      inspectionMode: "stable-governance-baseline",
      project: {
        projectKey,
        name: projectName,
        description,
        status: String(project.status),
        aliases,
        ownershipClassification,
      },
      semanticSupport: {
        ownershipClassification,
        ownerDirectionEstablished: Boolean(directionExcerpt),
        directionExcerpt,
        directionRecordId,
        canonicalSupportingRecords: support,
      },
      advisories,
      dynamicCurrentStateRequiredForApproval: false,
      localSourceRequiredForApproval: false,
    },
    unknowns,
    baselineDraft: lines.join("\n"),
  };
}

export function inspectStableProjectFromLearningWork(workId: number) {
  if (!Number.isInteger(workId) || workId < 1) throw new Error("Invalid learning work ID.");
  const database = db();
  const work = database.prepare("SELECT * FROM learning_work_items WHERE id=?").get(workId) as Row | undefined;
  if (!work) throw new Error("Learning work item not found.");
  if (String(work.work_type) !== "project-inspection") throw new Error("Learning work item is not project-inspection work.");
  if (!["prepared", "completed"].includes(String(work.status))) throw new Error("Project inspection work must be prepared or completed.");
  const projectKey = String(work.project_key ?? "").trim();
  if (!projectKey) throw new Error("Project inspection work has no projectKey.");

  const inspected = inspectStableBaseline(projectKey);
  database.prepare(`
    INSERT INTO project_inspection_drafts (
      project_key, learning_work_id, queue_item_id, evidence_json, unknowns_json, baseline_draft, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'prepared')
    ON CONFLICT(project_key) DO UPDATE SET
      learning_work_id=excluded.learning_work_id,
      queue_item_id=excluded.queue_item_id,
      evidence_json=excluded.evidence_json,
      unknowns_json=excluded.unknowns_json,
      baseline_draft=excluded.baseline_draft,
      status='prepared',
      updated_at=CURRENT_TIMESTAMP
  `).run(
    projectKey,
    workId,
    Number(work.queue_item_id),
    JSON.stringify(inspected.evidence),
    JSON.stringify(inspected.unknowns),
    inspected.baselineDraft,
  );

  const draft = mapDraft(database.prepare("SELECT * FROM project_inspection_drafts WHERE project_key=?").get(projectKey) as Row);

  if (String(work.status) === "prepared") {
    database.prepare(`
      UPDATE learning_work_items
      SET status='completed',
          result_summary=?,
          evidence=?,
          completed_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      `Stable governance baseline inspection completed for ${projectKey}; draft #${draft.id} prepared with ${draft.unresolvedUnknowns.length} unresolved semantic UNKNOWN(s).`,
      `project_inspection_draft_id=${draft.id}; inspectionMode=stable-governance-baseline; canonicalWritePerformed=false; durableMemoryCreated=false`,
      workId,
    );
  }

  return {
    draft,
    canonicalWritePerformed: false,
    durableMemoryCreated: false,
    queueResolved: false,
    localSourceRequiredForApproval: false,
    dynamicCurrentStateRequiredForApproval: false,
    rule: "Stable baseline inspection canonicalizes neither files nor current state. It prepares stable identity/scope/ownership knowledge from active controlling evidence and still requires explicit owner approval.",
  };
}

export function getStableProjectBaselineInspectionStatus() {
  return {
    enabled: true,
    mode: "stable-governance-baseline",
    localSourceRequiredForApproval: false,
    dynamicCurrentStateRequiredForApproval: false,
    canonicalWritesEnabled: false,
    durableMemoryCreatedAutomatically: false,
    rule: "A stable project baseline may be prepared from approved controlling evidence without inventing a source-root or live-state requirement. Dynamic state remains separate from durable canonical identity.",
  };
}
