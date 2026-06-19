import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "services", "whispercpp");
const folders = [root, resolve(root, "models")];

for (const folder of folders) mkdirSync(folder, { recursive: true });
for (const folder of folders) {
  const keep = resolve(folder, ".gitkeep");
  if (!existsSync(keep)) writeFileSync(keep, "", { flag: "wx" });
}

console.log(`[FREEOS] whisper.cpp service folder ready: ${root}`);
console.log(`[FREEOS] Model folder ready: ${resolve(root, "models")}`);
console.log("[FREEOS] Nothing was deleted or overwritten.");
