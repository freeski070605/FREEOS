import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MemoryStore } = require("@freeos/memory-core");

const store = new MemoryStore();
const memory = store.getMemoryStatus();
const projects = store.getProjectStatus();

console.log(`[FREEOS] Database: ${memory.databasePath}`);
console.log(`[FREEOS] Database connected: ${memory.databaseConnected ? "yes" : "no"}`);
console.log(`[FREEOS] Approved memories: ${memory.approvedMemories}`);
console.log(`[FREEOS] Pending proposals: ${memory.pendingProposals}`);
console.log(`[FREEOS] Rejected proposals: ${memory.rejectedProposals}`);
console.log(`[FREEOS] Projects: ${projects.projectCount}`);
console.log(`[FREEOS] Project notes: ${memory.projectNotes}`);
console.log(`[FREEOS] Project folders verified: ${projects.foldersVerified ? "yes" : "no"}`);
store.close();

