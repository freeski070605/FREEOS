import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { ToolRegistry } = require("@freeos/tool-runner");
const registry = new ToolRegistry();
const tools = registry.registerDefaultTools();

for (const folder of ["generated", "exports"]) {
  const path = resolve(registry.rootDir, folder);
  await mkdir(path, { recursive: true });
  try { await writeFile(resolve(path, ".gitkeep"), "", { flag: "wx" }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
}

console.log(`[FREEOS] Tool tables ready: ${registry.databasePath}`);
console.log(`[FREEOS] Default tools registered: ${tools.length}`);
console.log("[FREEOS] generated/ and exports/ verified.");
console.log("[FREEOS] Dangerous actions remain disabled. Nothing was deleted or overwritten.");
registry.close();
