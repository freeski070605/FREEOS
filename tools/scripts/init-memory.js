import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MemoryStore } = require("@freeos/memory-core");

const store = new MemoryStore();
const status = store.getProjectStatus();

console.log(`[FREEOS] Memory database ready: ${store.databasePath}`);
console.log(`[FREEOS] Default projects ready: ${status.projectCount}`);
console.log(`[FREEOS] Project folders verified: ${status.foldersVerified ? "yes" : "no"}`);
console.log("[FREEOS] Nothing was deleted or overwritten.");
store.close();

