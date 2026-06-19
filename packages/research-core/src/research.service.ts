import Database from "better-sqlite3";
import { getMemoryStore, type MemoryCategory } from "@freeos/memory-core";
import { domainFromUrl, ResearchError } from "./sourceUtils";
import type { NormalizedSearchResult, ResearchSession, SavedResearch } from "./research.types";

type Row = Record<string, unknown>;

function sessionFromRow(row: Row): ResearchSession {
  return { id: Number(row.id), title: String(row.title), query: String(row.query), projectKey: row.project_key == null ? null : String(row.project_key), status: String(row.status), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.result_count == null ? {} : { resultCount: Number(row.result_count) }) };
}

function resultFromRow(row: Row): NormalizedSearchResult {
  const url = String(row.url);
  return { id: Number(row.id), sessionId: row.session_id == null ? null : Number(row.session_id), title: String(row.title), url, source: String(row.source), snippet: String(row.snippet ?? ""), domain: row.domain == null ? domainFromUrl(url) : String(row.domain), contentPreview: row.content_preview == null ? null : String(row.content_preview), summary: row.summary == null ? null : String(row.summary), projectKey: row.project_key == null ? null : String(row.project_key), savedAsMemoryProposalId: row.saved_as_memory_proposal_id == null ? null : Number(row.saved_as_memory_proposal_id), savedAsProjectNoteId: row.saved_as_project_note_id == null ? null : Number(row.saved_as_project_note_id), createdAt: String(row.created_at) };
}

export class ResearchService {
  readonly #db: Database.Database;
  constructor() {
    const memory = getMemoryStore();
    this.#db = new Database(memory.databasePath);
    this.#db.pragma("foreign_keys = ON");
    this.#db.pragma("journal_mode = WAL");
  }

  close(): void { this.#db.close(); }

  #projectKey(value?: string | null): string | null {
    if (!value?.trim()) return null;
    const key = value.trim();
    if (!getMemoryStore().getProjectByKey(key)) throw new ResearchError(`Unknown projectKey: ${key}.`, "validation");
    return key;
  }

  #event(type: string, message: string, metadata: object): void {
    this.#db.prepare("INSERT INTO system_events (event_type, message, metadata) VALUES (?, ?, ?)").run(type, message, JSON.stringify(metadata));
  }

  createResearchSession(input: { query: string; title?: string; projectKey?: string | null; status?: string }): ResearchSession {
    const query = input.query?.trim();
    if (!query) throw new ResearchError("query is required.", "validation");
    const projectKey = this.#projectKey(input.projectKey);
    const result = this.#db.prepare("INSERT INTO research_sessions (title, query, project_key, status) VALUES (?, ?, ?, ?)").run(input.title?.trim() || query, query, projectKey, input.status ?? "completed");
    const session = sessionFromRow(this.#db.prepare("SELECT * FROM research_sessions WHERE id = ?").get(result.lastInsertRowid) as Row);
    this.#event("research.session.created", "Research session saved.", { sessionId: session.id, query, projectKey });
    return session;
  }

  saveResearchResults(sessionId: number | null, results: NormalizedSearchResult[], projectKey?: string | null): NormalizedSearchResult[] {
    const key = this.#projectKey(projectKey);
    const save = this.#db.transaction(() => results.map((item) => {
      const inserted = this.#db.prepare("INSERT INTO research_results (session_id, title, url, source, snippet, project_key) VALUES (?, ?, ?, ?, ?, ?)").run(sessionId, item.title, item.url, item.source, item.snippet, key);
      const id = Number(inserted.lastInsertRowid);
      this.#db.prepare("INSERT INTO research_sources (result_id, url, title, domain, metadata) VALUES (?, ?, ?, ?, ?)").run(id, item.url, item.title, item.domain, JSON.stringify({ source: item.source, kind: "search-result" }));
      return this.getResearchResult(id);
    }));
    const saved = save();
    this.#event("research.results.saved", "Research results saved.", { sessionId, count: saved.length, projectKey: key });
    return saved;
  }

  saveSessionWithResults(input: { query: string; title?: string; projectKey?: string | null }, results: NormalizedSearchResult[]): SavedResearch {
    const session = this.createResearchSession(input);
    return { session, results: this.saveResearchResults(session.id, results, input.projectKey) };
  }

  getResearchHistory(limit = 25): ResearchSession[] {
    return (this.#db.prepare(`SELECT s.*, COUNT(r.id) AS result_count FROM research_sessions s LEFT JOIN research_results r ON r.session_id = s.id GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC LIMIT ?`).all(Math.min(Math.max(Math.trunc(limit), 1), 100)) as Row[]).map(sessionFromRow);
  }

  getResearchSession(id: number): SavedResearch {
    const row = this.#db.prepare("SELECT * FROM research_sessions WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new ResearchError("Research session not found.", "not_found");
    return { session: sessionFromRow(row), results: this.listSessionResults(id) };
  }

  listSessionResults(sessionId: number): NormalizedSearchResult[] {
    return (this.#db.prepare(`SELECT r.*, s.domain FROM research_results r LEFT JOIN research_sources s ON s.result_id = r.id WHERE r.session_id = ? GROUP BY r.id ORDER BY r.id`).all(sessionId) as Row[]).map(resultFromRow);
  }

  getResearchResult(id: number): NormalizedSearchResult {
    const row = this.#db.prepare(`SELECT r.*, s.domain FROM research_results r LEFT JOIN research_sources s ON s.result_id = r.id WHERE r.id = ? GROUP BY r.id`).get(id) as Row | undefined;
    if (!row) throw new ResearchError("Research result not found.", "not_found");
    return resultFromRow(row);
  }

  updateResultRead(id: number, input: { title: string; url: string; contentPreview: string }): NormalizedSearchResult {
    this.getResearchResult(id);
    this.#db.prepare("UPDATE research_results SET title = ?, url = ?, content_preview = ? WHERE id = ?").run(input.title, input.url, input.contentPreview, id);
    this.#db.prepare("INSERT INTO research_sources (result_id, url, title, domain, metadata) VALUES (?, ?, ?, ?, ?)").run(id, input.url, input.title, domainFromUrl(input.url), JSON.stringify({ kind: "page-read" }));
    this.#event("research.page.read", "Public research page read.", { resultId: id, url: input.url });
    return this.getResearchResult(id);
  }

  updateResultSummary(id: number, summary: string, contentPreview?: string): NormalizedSearchResult {
    this.getResearchResult(id);
    this.#db.prepare("UPDATE research_results SET summary = ?, content_preview = COALESCE(?, content_preview) WHERE id = ?").run(summary, contentPreview ?? null, id);
    this.#event("research.result.summarized", "Research result summarized locally.", { resultId: id });
    return this.getResearchResult(id);
  }

  createMemoryProposalFromResearch(id: number, input: { title?: string; category?: string; projectKey?: string | null; tags?: string[]; reason?: string } = {}) {
    const result = this.getResearchResult(id);
    if (result.savedAsMemoryProposalId) throw new ResearchError("This result is already linked to a memory proposal.", "conflict");
    const content = [result.summary || result.contentPreview || result.snippet, `Source: ${result.url}`].filter(Boolean).join("\n\n");
    const proposal = getMemoryStore().createProposal({ title: input.title?.trim() || result.title, content, category: (input.category?.trim() || "research") as MemoryCategory, projectKey: input.projectKey ?? result.projectKey, tags: input.tags ?? ["research", result.domain], reason: input.reason?.trim() || "Created explicitly from a web research result.", source: `research:${id}` });
    this.#db.prepare("UPDATE research_results SET saved_as_memory_proposal_id = ? WHERE id = ?").run(proposal.id, id);
    this.#event("research.memory_proposal.created", "Pending memory proposal created from research.", { resultId: id, proposalId: proposal.id });
    return proposal;
  }

  createProjectNoteFromResearch(id: number, input: { title?: string; projectKey: string; tags?: string[] }) {
    const result = this.getResearchResult(id);
    if (result.savedAsProjectNoteId) throw new ResearchError("This result is already linked to a project note.", "conflict");
    const content = [result.summary || result.contentPreview || result.snippet, `Source: ${result.url}`].filter(Boolean).join("\n\n");
    const note = getMemoryStore().createProjectNote({ title: input.title?.trim() || result.title, content, projectKey: input.projectKey, tags: input.tags ?? ["research", result.domain], source: `research:${id}` });
    this.#db.prepare("UPDATE research_results SET saved_as_project_note_id = ? WHERE id = ?").run(note.id, id);
    this.#event("research.project_note.created", "Project note created from research.", { resultId: id, noteId: note.id, projectKey: input.projectKey });
    return note;
  }

  getStatusCounts(): { sessions: number; results: number; sources: number } {
    const count = (table: string) => Number((this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count);
    return { sessions: count("research_sessions"), results: count("research_results"), sources: count("research_sources") };
  }
}

let defaultService: ResearchService | undefined;
export function getResearchService(): ResearchService { defaultService ??= new ResearchService(); return defaultService; }
export const createResearchSession = (input: Parameters<ResearchService["createResearchSession"]>[0]) => getResearchService().createResearchSession(input);
export const saveResearchResults = (sessionId: number | null, results: NormalizedSearchResult[], projectKey?: string | null) => getResearchService().saveResearchResults(sessionId, results, projectKey);
export const createMemoryProposalFromResearch = (id: number, input?: Parameters<ResearchService["createMemoryProposalFromResearch"]>[1]) => getResearchService().createMemoryProposalFromResearch(id, input);
export const createProjectNoteFromResearch = (id: number, input: Parameters<ResearchService["createProjectNoteFromResearch"]>[1]) => getResearchService().createProjectNoteFromResearch(id, input);
export const getResearchHistory = (limit?: number) => getResearchService().getResearchHistory(limit);
