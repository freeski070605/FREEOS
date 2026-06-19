import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_PROJECTS, DEFAULT_SAFETY_POLICY } from "./defaults";
import type {
  CreateMemoryInput,
  CreateProjectNoteInput,
  CreateProposalInput,
  LocalContextOptions,
  Memory,
  MemoryCategory,
  MemoryProposal,
  MemorySearch,
  MemoryStatusCounts,
  Project,
  ProjectNote,
  ProjectStatusCounts,
  ProposalStatus,
} from "./memory.types";

type Row = Record<string, unknown>;

export class MemoryCoreError extends Error {
  constructor(
    message: string,
    readonly code: "validation" | "not_found" | "conflict" | "database",
  ) {
    super(message);
    this.name = "MemoryCoreError";
  }
}

function findFreeosRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    try {
      const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: string };
      if (packageJson.name === "freeos") return current;
    } catch {
      // Keep walking up until the repository root is found.
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MemoryCoreError(`${label} is required.`, "validation");
  }
  return value.trim();
}

function tagsToText(tags: string[] | undefined): string {
  const clean = (tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  return JSON.stringify([...new Set(clean)]);
}

function tagsFromText(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function memoryFromRow(row: Row): Memory {
  return {
    id: Number(row.id),
    title: String(row.title),
    content: String(row.content),
    category: String(row.category) as MemoryCategory,
    projectKey: row.project_key == null ? null : String(row.project_key),
    source: String(row.source),
    status: "approved",
    tags: tagsFromText(row.tags),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function proposalFromRow(row: Row): MemoryProposal {
  return {
    id: Number(row.id),
    title: String(row.title),
    content: String(row.content),
    category: String(row.category) as MemoryCategory,
    projectKey: row.project_key == null ? null : String(row.project_key),
    source: String(row.source),
    tags: tagsFromText(row.tags),
    reason: String(row.reason),
    status: String(row.status) as ProposalStatus,
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
  };
}

function projectFromRow(row: Row): Project {
  return {
    id: Number(row.id),
    projectKey: String(row.project_key),
    name: String(row.name),
    description: String(row.description),
    folderPath: String(row.folder_path),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function noteFromRow(row: Row): ProjectNote {
  return {
    id: Number(row.id),
    projectKey: String(row.project_key),
    title: String(row.title),
    content: String(row.content),
    source: String(row.source),
    tags: tagsFromText(row.tags),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface MemoryStoreOptions {
  rootDir?: string;
  databasePath?: string;
}

export class MemoryStore {
  readonly rootDir: string;
  readonly databasePath: string;
  readonly #database: Database.Database;

  constructor(options: MemoryStoreOptions = {}) {
    this.rootDir = resolve(options.rootDir ?? process.env.FREEOS_ROOT ?? findFreeosRoot());
    this.databasePath = resolve(options.databasePath ?? join(this.rootDir, "data", "freeos.sqlite"));
    mkdirSync(dirname(this.databasePath), { recursive: true });
    try {
      this.#database = new Database(this.databasePath);
      this.#database.pragma("foreign_keys = ON");
      this.#database.pragma("journal_mode = WAL");
      this.initialize();
    } catch (error) {
      throw new MemoryCoreError(
        `Unable to open the local memory database: ${error instanceof Error ? error.message : "unknown error"}`,
        "database",
      );
    }
  }

  initialize(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        project_key TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'approved',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE TABLE IF NOT EXISTS memory_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        project_key TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        tags TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE TABLE IF NOT EXISTS project_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS research_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        query TEXT NOT NULL,
        project_key TEXT,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE TABLE IF NOT EXISTS research_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',
        content_preview TEXT,
        summary TEXT,
        project_key TEXT,
        saved_as_memory_proposal_id INTEGER,
        saved_as_project_note_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES research_sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (project_key) REFERENCES projects(project_key),
        FOREIGN KEY (saved_as_memory_proposal_id) REFERENCES memory_proposals(id),
        FOREIGN KEY (saved_as_project_note_id) REFERENCES project_notes(id)
      );
      CREATE TABLE IF NOT EXISTS research_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        domain TEXT,
        retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT,
        FOREIGN KEY (result_id) REFERENCES research_results(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        input_text TEXT,
        transcript TEXT,
        response_text TEXT,
        audio_input_path TEXT,
        audio_output_path TEXT,
        stt_engine TEXT,
        tts_engine TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS voice_transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        transcript TEXT NOT NULL,
        source TEXT NOT NULL,
        audio_path TEXT,
        confidence REAL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES voice_sessions(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS voice_outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        text TEXT NOT NULL,
        engine TEXT NOT NULL,
        output_path TEXT,
        status TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES voice_sessions(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS tool_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        requires_approval INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tool_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        requested_args TEXT NOT NULL DEFAULT '{}',
        risk_level TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by TEXT NOT NULL DEFAULT 'dashboard',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT,
        result_id INTEGER,
        FOREIGN KEY (tool_key) REFERENCES tool_registry(tool_key),
        FOREIGN KEY (result_id) REFERENCES tool_runs(id)
      );
      CREATE TABLE IF NOT EXISTS tool_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_key TEXT NOT NULL,
        request_id INTEGER,
        status TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '{}',
        output TEXT,
        error TEXT,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT,
        FOREIGN KEY (tool_key) REFERENCES tool_registry(tool_key),
        FOREIGN KEY (request_id) REFERENCES tool_requests(id)
      );
      CREATE TABLE IF NOT EXISTS automation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0,
        trigger_type TEXT NOT NULL,
        trigger_config TEXT NOT NULL DEFAULT '{}',
        action_tool_key TEXT NOT NULL,
        action_args TEXT NOT NULL DEFAULT '{}',
        requires_approval INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (action_tool_key) REFERENCES tool_registry(tool_key)
      );
      CREATE TABLE IF NOT EXISTS automation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_key TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rule_key) REFERENCES automation_rules(rule_key)
      );
      CREATE TABLE IF NOT EXISTS command_chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        response TEXT NOT NULL,
        project_key TEXT,
        model TEXT NOT NULL,
        used_memory INTEGER NOT NULL DEFAULT 0,
        used_project_notes INTEGER NOT NULL DEFAULT 0,
        used_research_context INTEGER NOT NULL DEFAULT 0,
        created_memory_proposal_id INTEGER,
        created_tool_request_id INTEGER,
        audio_output_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_key) REFERENCES projects(project_key),
        FOREIGN KEY (created_memory_proposal_id) REFERENCES memory_proposals(id),
        FOREIGN KEY (created_tool_request_id) REFERENCES tool_requests(id)
      );
      CREATE TABLE IF NOT EXISTS backup_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backup_path TEXT NOT NULL UNIQUE,
        manifest TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_key);
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON memory_proposals(status);
      CREATE INDEX IF NOT EXISTS idx_notes_project ON project_notes(project_key);
      CREATE INDEX IF NOT EXISTS idx_research_sessions_created ON research_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_research_results_session ON research_results(session_id);
      CREATE INDEX IF NOT EXISTS idx_research_sources_result ON research_sources(result_id);
      CREATE INDEX IF NOT EXISTS idx_voice_sessions_created ON voice_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_voice_transcripts_session ON voice_transcripts(session_id);
      CREATE INDEX IF NOT EXISTS idx_voice_outputs_session ON voice_outputs(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_requests_status ON tool_requests(status);
      CREATE INDEX IF NOT EXISTS idx_tool_runs_started ON tool_runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_automation_events_created ON automation_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_command_chat_created ON command_chat_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_backup_events_created ON backup_events(created_at);
      CREATE TABLE IF NOT EXISTS rag_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL UNIQUE,
        project_key TEXT,
        source_type TEXT NOT NULL DEFAULT 'folder',
        root_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE TABLE IF NOT EXISTS rag_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER,
        project_key TEXT,
        file_path TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        file_ext TEXT,
        file_size INTEGER,
        file_hash TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        indexed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_id) REFERENCES rag_sources(id) ON DELETE SET NULL,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT,
        token_estimate INTEGER,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS rag_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER,
        embedding_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS rag_index_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        root_path TEXT NOT NULL,
        project_key TEXT,
        files_seen INTEGER NOT NULL DEFAULT 0,
        files_indexed INTEGER NOT NULL DEFAULT 0,
        chunks_created INTEGER NOT NULL DEFAULT 0,
        errors TEXT,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE TABLE IF NOT EXISTS rag_queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        project_key TEXT,
        mode TEXT NOT NULL DEFAULT 'keyword',
        top_k INTEGER NOT NULL DEFAULT 8,
        results_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_key) REFERENCES projects(project_key)
      );
      CREATE INDEX IF NOT EXISTS idx_rag_sources_enabled ON rag_sources(enabled);
      CREATE INDEX IF NOT EXISTS idx_rag_documents_status ON rag_documents(status);
      CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON rag_documents(source_id);
      CREATE INDEX IF NOT EXISTS idx_rag_documents_project ON rag_documents(project_key);
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_document ON rag_chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_rag_embeddings_chunk ON rag_embeddings(chunk_id);
      CREATE INDEX IF NOT EXISTS idx_rag_index_jobs_status ON rag_index_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_rag_queries_created ON rag_queries(created_at);
    `);

    const insertProject = this.#database.prepare(`
      INSERT OR IGNORE INTO projects (project_key, name, description, folder_path)
      VALUES (?, ?, ?, ?)
    `);
    const seed = this.#database.transaction(() => {
      for (const project of DEFAULT_PROJECTS) {
        insertProject.run(
          project.projectKey,
          project.name,
          project.description,
          `data/projects/${project.projectKey}`,
        );
      }
    });
    seed();
    this.ensureProjectFolders();
  }

  ensureProjectFolders(): void {
    for (const project of DEFAULT_PROJECTS) {
      const folder = join(this.rootDir, "data", "projects", project.projectKey);
      mkdirSync(folder, { recursive: true });
      const readme = join(folder, "README.md");
      if (!existsSync(readme)) {
        writeFileSync(
          readme,
          `# ${project.name}\n\n${project.description}\n\n## What FREEOS should store here\n\nKeep approved project knowledge, working notes, references, and user-provided artifacts related to ${project.name}.\n\n## Example notes\n\n- Decisions and current priorities\n- Approved project context\n- Useful references and non-sensitive planning notes\n\nAll files in this folder stay local. FREEOS does not scan or save private files automatically.\n`,
          { encoding: "utf8", flag: "wx" },
        );
      }
    }
  }

  close(): void {
    this.#database.close();
  }

  #assertProject(projectKey: string | null | undefined): string | null {
    if (projectKey == null || projectKey === "") return null;
    const clean = projectKey.trim();
    if (!this.getProjectByKey(clean)) {
      throw new MemoryCoreError(`Unknown projectKey: ${clean}.`, "validation");
    }
    return clean;
  }

  createProposal(input: CreateProposalInput): MemoryProposal {
    const projectKey = this.#assertProject(input.projectKey);
    const result = this.#database.prepare(`
      INSERT INTO memory_proposals (title, content, category, project_key, source, tags, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      required(input.title, "title"),
      required(input.content, "content"),
      required(input.category, "category"),
      projectKey,
      input.source?.trim() || "manual",
      tagsToText(input.tags),
      input.reason?.trim() || "",
    );
    return proposalFromRow(this.#database.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(result.lastInsertRowid) as Row);
  }

  listProposals(status: ProposalStatus = "pending"): MemoryProposal[] {
    return (this.#database.prepare("SELECT * FROM memory_proposals WHERE status = ? ORDER BY created_at DESC, id DESC").all(status) as Row[]).map(proposalFromRow);
  }

  approveProposal(id: number): { proposal: MemoryProposal; memory: Memory } {
    if (!Number.isInteger(id) || id < 1) throw new MemoryCoreError("Invalid proposal ID.", "validation");
    const approve = this.#database.transaction(() => {
      const row = this.#database.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id) as Row | undefined;
      if (!row) throw new MemoryCoreError("Memory proposal not found.", "not_found");
      if (row.status !== "pending") {
        throw new MemoryCoreError(`Memory proposal is already ${String(row.status)}.`, "conflict");
      }
      const result = this.#database.prepare(`
        INSERT INTO memories (title, content, category, project_key, source, status, tags)
        VALUES (?, ?, ?, ?, ?, 'approved', ?)
      `).run(row.title, row.content, row.category, row.project_key, row.source, row.tags);
      this.#database.prepare("UPDATE memory_proposals SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      const proposal = proposalFromRow(this.#database.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id) as Row);
      const memory = memoryFromRow(this.#database.prepare("SELECT * FROM memories WHERE id = ?").get(result.lastInsertRowid) as Row);
      return { proposal, memory };
    });
    return approve();
  }

  rejectProposal(id: number): MemoryProposal {
    if (!Number.isInteger(id) || id < 1) throw new MemoryCoreError("Invalid proposal ID.", "validation");
    const row = this.#database.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new MemoryCoreError("Memory proposal not found.", "not_found");
    if (row.status !== "pending") {
      throw new MemoryCoreError(`Memory proposal is already ${String(row.status)}.`, "conflict");
    }
    this.#database.prepare("UPDATE memory_proposals SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return proposalFromRow(this.#database.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id) as Row);
  }

  createMemory(input: CreateMemoryInput): Memory {
    const projectKey = this.#assertProject(input.projectKey);
    const result = this.#database.prepare(`
      INSERT INTO memories (title, content, category, project_key, source, status, tags)
      VALUES (?, ?, ?, ?, ?, 'approved', ?)
    `).run(
      required(input.title, "title"),
      required(input.content, "content"),
      required(input.category, "category"),
      projectKey,
      input.source?.trim() || "manual-explicit",
      tagsToText(input.tags),
    );
    return memoryFromRow(this.#database.prepare("SELECT * FROM memories WHERE id = ?").get(result.lastInsertRowid) as Row);
  }

  listApprovedMemories(search: MemorySearch = {}): Memory[] {
    const clauses = ["status = 'approved'"];
    const parameters: unknown[] = [];
    if (search.projectKey) {
      clauses.push("project_key = ?");
      parameters.push(this.#assertProject(search.projectKey));
    }
    if (search.category) {
      clauses.push("category = ?");
      parameters.push(search.category);
    }
    if (search.q?.trim()) {
      clauses.push("(title LIKE ? OR content LIKE ? OR tags LIKE ?)");
      const keyword = `%${search.q.trim()}%`;
      parameters.push(keyword, keyword, keyword);
    }
    const limit = Math.min(Math.max(search.limit ?? 100, 1), 500);
    parameters.push(limit);
    return (this.#database.prepare(`SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...parameters) as Row[]).map(memoryFromRow);
  }

  searchMemoriesBasic(search: MemorySearch): Memory[] {
    return this.listApprovedMemories(search);
  }

  listProjects(): Project[] {
    return (this.#database.prepare("SELECT * FROM projects ORDER BY name").all() as Row[]).map(projectFromRow);
  }

  getProjectByKey(projectKey: string): Project | null {
    const row = this.#database.prepare("SELECT * FROM projects WHERE project_key = ?").get(projectKey) as Row | undefined;
    return row ? projectFromRow(row) : null;
  }

  createProjectNote(input: CreateProjectNoteInput): ProjectNote {
    const projectKey = this.#assertProject(required(input.projectKey, "projectKey"));
    const result = this.#database.prepare(`
      INSERT INTO project_notes (project_key, title, content, source, tags)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      projectKey,
      required(input.title, "title"),
      required(input.content, "content"),
      input.source?.trim() || "manual",
      tagsToText(input.tags),
    );
    return noteFromRow(this.#database.prepare("SELECT * FROM project_notes WHERE id = ?").get(result.lastInsertRowid) as Row);
  }

  listProjectNotes(projectKey: string, limit = 200): ProjectNote[] {
    const clean = this.#assertProject(required(projectKey, "projectKey"));
    return (this.#database.prepare("SELECT * FROM project_notes WHERE project_key = ? ORDER BY updated_at DESC, id DESC LIMIT ?").all(clean, Math.min(Math.max(limit, 1), 500)) as Row[]).map(noteFromRow);
  }

  getMemoryStatus(): MemoryStatusCounts {
    const count = (table: string, where = ""): number => Number((this.#database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as Row).count);
    return {
      databaseConnected: this.#database.open,
      databasePath: this.databasePath,
      approvedMemories: count("memories", "WHERE status = 'approved'"),
      pendingProposals: count("memory_proposals", "WHERE status = 'pending'"),
      rejectedProposals: count("memory_proposals", "WHERE status = 'rejected'"),
      projectNotes: count("project_notes"),
    };
  }

  getProjectStatus(): ProjectStatusCounts {
    const folders = this.listProjects().map((project) => ({
      projectKey: project.projectKey,
      folderPath: project.folderPath,
      exists: existsSync(resolve(this.rootDir, project.folderPath)),
    }));
    return {
      projectCount: folders.length,
      notesCount: Number((this.#database.prepare("SELECT COUNT(*) AS count FROM project_notes").get() as Row).count),
      foldersVerified: folders.every((folder) => folder.exists),
      folders,
    };
  }

  getProjectDetails(projectKey: string): Project & { noteCount: number } {
    const project = this.getProjectByKey(required(projectKey, "projectKey"));
    if (!project) throw new MemoryCoreError(`Unknown projectKey: ${projectKey}.`, "not_found");
    const noteCount = Number((this.#database.prepare("SELECT COUNT(*) AS count FROM project_notes WHERE project_key = ?").get(project.projectKey) as Row).count);
    return { ...project, noteCount };
  }

  getDatabase(): Database.Database {
    return this.#database;
  }

  buildLocalContext(options: LocalContextOptions = {}): string {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const memories = options.memoryQuery?.trim()
      ? this.searchMemoriesBasic({ q: options.memoryQuery, projectKey: options.projectKey, limit })
      : [];
    const notes = options.projectKey && options.includeProjectNotes
      ? this.listProjectNotes(options.projectKey, limit)
      : [];
    const sections = [
      `SYSTEM SAFETY POLICY\n${options.safetyPolicy?.trim() || DEFAULT_SAFETY_POLICY}`,
    ];
    if (memories.length) {
      sections.push(`APPROVED MEMORIES\n${memories.map((memory) => `- ${memory.title}: ${memory.content}`).join("\n")}`);
    }
    if (notes.length) {
      sections.push(`SELECTED PROJECT NOTES (${options.projectKey})\n${notes.map((note) => `- ${note.title}: ${note.content}`).join("\n")}`);
    }
    return sections.join("\n\n");
  }
}

let defaultStore: MemoryStore | undefined;

export function getMemoryStore(): MemoryStore {
  defaultStore ??= new MemoryStore();
  return defaultStore;
}
