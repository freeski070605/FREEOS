export * from "./database";
export * from "./defaults";
export * from "./memory.types";

import { getMemoryStore } from "./database";
import type { CreateMemoryInput, CreateProjectNoteInput, CreateProposalInput, LocalContextOptions, MemorySearch, ProposalStatus } from "./memory.types";

export const createProposal = (input: CreateProposalInput) => getMemoryStore().createProposal(input);
export const approveProposal = (id: number) => getMemoryStore().approveProposal(id);
export const rejectProposal = (id: number) => getMemoryStore().rejectProposal(id);
export const listProposals = (status?: ProposalStatus) => getMemoryStore().listProposals(status);
export const listApprovedMemories = (search?: MemorySearch) => getMemoryStore().listApprovedMemories(search);
export const createMemory = (input: CreateMemoryInput) => getMemoryStore().createMemory(input);
export const searchMemoriesBasic = (search: MemorySearch) => getMemoryStore().searchMemoriesBasic(search);
export const createProjectNote = (input: CreateProjectNoteInput) => getMemoryStore().createProjectNote(input);
export const listProjects = () => getMemoryStore().listProjects();
export const getProjectByKey = (projectKey: string) => getMemoryStore().getProjectByKey(projectKey);
export const buildLocalContext = (options?: LocalContextOptions) => getMemoryStore().buildLocalContext(options);

