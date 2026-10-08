import { getToolRegistry } from "@freeos/tool-runner";
import { availableLocalProjectSources } from "./projectSource.service";
import { createCurrentIntelligence } from "./currentIntelligence.service";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

function db(): Database {
  return getToolRegistry().database;
}

function tableExists(database: Database, name: string): boolean {
  const row = database.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name) as Row | undefined;
  return Boolean(row?.ok);
}

function governedProjectRagCount(database: Database, projectKey: string): number {
  if (!tableExists(database, "rag_documents") || !tableExists(database, "knowledge_records")) return 0;
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM rag_documents d
    JOIN knowledge_records kr
      ON kr.source_type='rag-document'
     AND kr.source_ref=d.file_path
     AND kr.project_key=d.project_key
    WHERE d.project_key=?
      AND d.status='indexed'
      AND kr.status='active'
  `).get(projectKey) as { count: number };
  return Number(row.count ?? 0);
}

export function observeProjectLocalState(projectKey: string) {
  const clean = projectKey.trim();
  if (!clean) throw new Error("projectKey is required.");
  const sources = availableLocalProjectSources(clean);
  if (sources.length === 0) throw new Error("No available local project source root is registered for this project.");

  const primary = sources[0];
  const governedRagDocuments = governedProjectRagCount(db(), clean);
  const entries = primary.topLevelEntries.slice(0, 20);
  const observedAt = new Date().toISOString();
  const sourceRootSummary = sources.map((source) => source.resolvedPath || source.location).join("; ");
  const claim = [
    `${sources.length} registered local project source root(s) are currently available for ${clean}.`,
    `Primary source root is readable at ${primary.resolvedPath || primary.location}.`,
    entries.length ? `Observed top-level entries include: ${entries.join(", ")}.` : "No top-level entry names were captured.",
    `${governedRagDocuments} active governed project RAG document(s) are currently registered.`,
  ].join(" ");

  const item = createCurrentIntelligence({
    sourceKey: `project-local-state:${clean}`,
    topic: "Project local state",
    claim,
    projectKey: clean,
    sourceUrl: `local://project-source/${clean}`,
    sourceTitle: "FREEOS local project source observation",
    sourceClass: "live-observation",
    confidence: "confirmed",
    evidence: `Read-only source-root observation. Available roots: ${sourceRootSummary}. No runtime-health inference was made.`,
    observedAt,
    freshnessDays: 1,
  });

  return {
    item,
    sourceRootsObserved: sources.length,
    governedRagDocuments,
    sourceModified: false,
    durableMemoryCreated: false,
    canonicalWritePerformed: false,
    operationalHealthInferred: false,
    rule: "Local project-state observation records only directly observed source availability and governed evidence state. It does not infer that the project is healthy, complete, or production-ready.",
  };
}

export function getProjectStateObservationStatus() {
  return {
    enabled: true,
    mode: "read-only-live-observation",
    sourceWritesEnabled: false,
    canonicalWritesEnabled: false,
    durableMemoryCreatedAutomatically: false,
    observationAuthority: "live-observation",
    freshnessDays: 1,
    operationalHealthInferred: false,
    rule: "Observe current local project state narrowly and freshness-bound it; do not turn source availability into a broader operational-health claim.",
  };
}
