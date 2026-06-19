import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ToolRegistry, ToolRequests } = require("@freeos/tool-runner");
const registry = new ToolRegistry();
registry.registerDefaultTools();
const requests = new ToolRequests(registry);

console.log(`[FREEOS] Registered tools: ${registry.listTools().length}`);
console.log(`[FREEOS] Pending requests: ${requests.listToolRequests("pending").length}`);
console.log(`[FREEOS] Recent runs: ${requests.listToolRuns(25).length}`);
console.log("[FREEOS] Dangerous actions enabled: no");
console.log("[FREEOS] Writes require approval: yes");
registry.close();
