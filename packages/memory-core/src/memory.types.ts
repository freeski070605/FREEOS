export type MemoryStatus = "approved";
export type ProposalStatus = "pending" | "approved" | "rejected";
export type MemoryCategory =
  | "general"
  | "fact"
  | "preference"
  | "decision"
  | "project"
  | "reference"
  | "research";

export interface Memory {
  id: number;
  title: string;
  content: string;
  category: MemoryCategory;
  projectKey: string | null;
  source: string;
  status: MemoryStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryProposal {
  id: number;
  title: string;
  content: string;
  category: MemoryCategory;
  projectKey: string | null;
  source: string;
  tags: string[];
  reason: string;
  status: ProposalStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface Project {
  id: number;
  projectKey: string;
  name: string;
  description: string;
  folderPath: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectNote {
  id: number;
  projectKey: string;
  title: string;
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  title: string;
  content: string;
  category: MemoryCategory;
  projectKey?: string | null;
  source?: string;
  tags?: string[];
}

export interface CreateProposalInput extends CreateMemoryInput {
  reason?: string;
}

export interface CreateProjectNoteInput {
  projectKey: string;
  title: string;
  content: string;
  source?: string;
  tags?: string[];
}

export interface MemorySearch {
  projectKey?: string;
  category?: MemoryCategory;
  q?: string;
  limit?: number;
}

export interface MemoryStatusCounts {
  databaseConnected: boolean;
  databasePath: string;
  approvedMemories: number;
  pendingProposals: number;
  rejectedProposals: number;
  projectNotes: number;
}

export interface ProjectStatusCounts {
  projectCount: number;
  notesCount: number;
  foldersVerified: boolean;
  folders: Array<{ projectKey: string; folderPath: string; exists: boolean }>;
}

export interface LocalContextOptions {
  memoryQuery?: string;
  projectKey?: string;
  includeProjectNotes?: boolean;
  limit?: number;
  safetyPolicy?: string;
}
