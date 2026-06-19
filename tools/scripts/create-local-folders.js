import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const folders = ["data/memory", "data/documents", "data/vector-db", "data/logs"];

for (const folder of folders) {
  await mkdir(resolve(folder), { recursive: true });
  console.log(`[FREEOS] Verified ${folder}`);
}

console.log("[FREEOS] Local folders are ready. Nothing was deleted.");

