import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getMemoryStore } from "@freeos/memory-core";
import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

export const projectSourceTypes = ["local-folder", "git-repository", "reference"] as const;
export type ProjectSourceType = (typeof projectSourceTypes)[number];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS project_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        location TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_key, source_type, location),
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE INDEX IF NOT EXISTS idx_project_sources_project ON project_sources(project_key);
      CREATE INDEX IF NOT EXISTS idx_project_sources_enabled ON project_sources(enabled);
    `);
    schemaReady = true;
  }
  return database;
}

function validateProject(projectKey: string): string {
  const clean = projectKey.trim();
  if (!clean || !getMemoryStore().getProjectByKey(clean)) throw new Error(`Unknown projectKey: ${clean || "(empty)"}.`);
  return clean;
}

function localFolderSnapshot(location: string) {
  const resolvedPath = isAbsolute(location) ? location : resolve(getMemoryStore().rootDir, location);
  if (!existsSync(resolvedPath)) {
    return { available: false, resolvedPath, isDirectory: false, topLevelEntries: [] as string[] };
  }
  try {
    const isDirectory = statSync(resolvedPath).isDirectory();
    const topLevelEntries = isDirectory
      ? readdirSync(resolvedPath, { withFileTypes: true }).slice(0, 100).map((entry) => `${entry.isDirectory() ? "dir" : "file"}:${entry.name}`)
      : [];
    return { available: isDirectory, resolvedPath, isDirectory, topLevelEntries };
  } catch {
    return { available: false, resolvedPath, isDirectory: false, topLevelEntries: [] as string[] };
  }
}

function mapSource(row: Row) {
  const sourceType = String(row.source_type) as ProjectSourceType;
  const location = String(row.location);
  const snapshot = sourceType === "local-folder" ? localFolderSnapshot(location) : null;
  return {
    id: Number(row.id),
    projectKey: String(row.project_key),
    sourceType,
    location,
    label: String(row.label ?? ""),
    enabled: Boolean(Number(row.enabled)),
    available: snapshot ? snapshot.available : null,
    resolvedPath: snapshot?.resolvedPath ?? null,
    topLevelEntries: snapshot?.topLevelEntries ?? [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function registerProjectSource(input: {
  projectKey: string;
  sourceType: ProjectSourceType;
  location: string;
  label?: string;
}) {
  const database = db();
  const projectKey = validateProject(input.projectKey);
  const location = input.location.trim();
  if (!location) throw new Error("location is required.");
  if (input.sourceType === "local-folder" && !isAbsolute(location)) {
    throw new Error("local-folder sources must use an absolute path.");
  }

  database.prepare(`
    INSERT INTO project_sources (project_key, source_type, location, label, enabled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(project_key, source_type, location) DO UPDATE SET
      label=excluded.label,
      enabled=1,
      updated_at=CURRENT_TIMESTAMP
  `).run(projectKey, input.sourceType, location, input.label?.trim() ?? "");

  const row = database.prepare(`
    SELECT * FROM project_sources
    WHERE project_key=? AND source_type=? AND location=?
  `).get(projectKey, input.sourceType, location) as Row;
  return mapSource(row);
}

export function listProjectSources(projectKey?: string) {
  const database = db();
  if (projectKey?.trim()) {
    const clean = validateProject(projectKey);
    return (database.prepare("SELECT * FROM project_sources WHERE project_key=? ORDER BY enabled DESC,id").all(clean) as Row[]).map(mapSource);
  }
  return (database.prepare("SELECT * FROM project_sources ORDER BY project_key,id").all() as Row[]).map(mapSource);
}

export function setProjectSourceEnabled(id: number, enabled: boolean) {
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid project source ID.");
  const database = db();
  const existing = database.prepare("SELECT * FROM project_sources WHERE id=?").get(id) as Row | undefined;
  if (!existing) throw new Error("Project source not found.");
  database.prepare("UPDATE project_sources SET enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(enabled ? 1 : 0, id);
  return mapSource(database.prepare("SELECT * FROM project_sources WHERE id=?").get(id) as Row);
}

export function availableLocalProjectSources(projectKey: string) {
  return listProjectSources(projectKey).filter((source) => source.enabled && source.sourceType === "local-folder" && source.available === true);
}

export function getProjectSourceStatus() {
  const database = db();
  const total = Number((database.prepare("SELECT COUNT(*) AS count FROM project_sources").get() as { count: number }).count);
  const enabled = Number((database.prepare("SELECT COUNT(*) AS count FROM project_sources WHERE enabled=1").get() as { count: number }).count);
  const localSources = listProjectSources().filter((source) => source.sourceType === "local-folder");
  return {
    enabled: true,
    total,
    enabledSources: enabled,
    localFolders: localSources.length,
    availableLocalFolders: localSources.filter((source) => source.enabled && source.available === true).length,
    automaticIndexingEnabled: false,
    canonicalWritesEnabled: false,
    rule: "Project source registration records where evidence lives. Registration does not index files, create canonical knowledge, or grant write authority over the source.",
  };
}
