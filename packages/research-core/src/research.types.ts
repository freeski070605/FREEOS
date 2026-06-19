export interface NormalizedSearchResult {
  id?: number;
  sessionId?: number | null;
  title: string;
  url: string;
  snippet: string;
  source: string;
  domain: string;
  contentPreview?: string | null;
  summary?: string | null;
  projectKey?: string | null;
  savedAsMemoryProposalId?: number | null;
  savedAsProjectNoteId?: number | null;
  createdAt?: string;
}

export interface ResearchSession {
  id: number;
  title: string;
  query: string;
  projectKey: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  resultCount?: number;
}

export interface PageReadResult {
  title: string;
  url: string;
  domain: string;
  text: string;
  contentPreview: string;
  bytesRead: number;
}

export interface SearchOptions { maxResults?: number; language?: string }
export interface SavedResearch { session: ResearchSession; results: NormalizedSearchResult[] }
