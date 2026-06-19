#!/usr/bin/env node

import Database from "better-sqlite3";
import { join, resolve } from "node:path";
import { getRagConfig, RagService } from "@freeos/rag-core";

const freeosRoot = process.env.FREEOS_ROOT || resolve(process.cwd());
const dbPath = join(freeosRoot, "data", "freeos.sqlite");

// Get path argument
const pathArg = process.argv[2];
const rootPath = pathArg ? resolve(pathArg) : join(freeosRoot, "data", "documents");

console.log("[RAG Index]");
console.log(`Path: ${rootPath}`);
console.log("Starting index...\n");

try {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const config = getRagConfig();
  const service = new RagService(config, db);

  const job = await service.indexFolder(rootPath, undefined, undefined, false, config.embeddingsEnabled);

  console.log("\nIndex Job Complete:");
  console.log(`  Status: ${job.status}`);
  console.log(`  Files Seen: ${job.filesSeen}`);
  console.log(`  Files Indexed: ${job.filesIndexed}`);
  console.log(`  Chunks Created: ${job.chunksCreated}`);

  if (job.errors && job.errors.length > 0) {
    console.log(`\n  Errors: ${job.errors.length}`);
    for (const error of job.errors.slice(0, 5)) {
      console.log(`    - ${error.file}: ${error.error}`);
    }
  }

  db.close();
  console.log("\n✓ Indexing complete");
} catch (error) {
  console.error("[RAG] Error during indexing:", error);
  process.exit(1);
}
