#!/usr/bin/env node

import Database from "better-sqlite3";
import { join, resolve } from "node:path";

const freeosRoot = process.env.FREEOS_ROOT || resolve(process.cwd());
const dbPath = join(freeosRoot, "data", "freeos.sqlite");

console.log("[RAG Status Report]");
console.log("=".repeat(50));

try {
  const db = new Database(dbPath, { readonly: true });

  // Get document count
  const docCount = db.prepare("SELECT COUNT(*) as count FROM rag_documents WHERE status = 'indexed'").get();
  console.log(`Indexed Documents: ${docCount.count || 0}`);

  // Get chunk count
  const chunkCount = db.prepare("SELECT COUNT(*) as count FROM rag_chunks").get();
  console.log(`Total Chunks: ${chunkCount.count || 0}`);

  // Get embedding count
  const embeddingCount = db.prepare("SELECT COUNT(*) as count FROM rag_embeddings").get();
  console.log(`Embeddings: ${embeddingCount.count || 0}`);

  // Get last indexing job
  const lastJob = db.prepare("SELECT * FROM rag_index_jobs ORDER BY finished_at DESC LIMIT 1").get();
  if (lastJob) {
    console.log(`\nLast Index Job:`);
    console.log(`  Type: ${lastJob.job_type}`);
    console.log(`  Status: ${lastJob.status}`);
    console.log(`  Files Indexed: ${lastJob.files_indexed}/${lastJob.files_seen}`);
    console.log(`  Chunks Created: ${lastJob.chunks_created}`);
    console.log(`  Started: ${lastJob.started_at}`);
    if (lastJob.finished_at) {
      console.log(`  Finished: ${lastJob.finished_at}`);
    }
  }

  // Get sources
  const sources = db.prepare("SELECT * FROM rag_sources ORDER BY created_at").all();
  console.log(`\nRegistered Sources: ${sources.length}`);
  for (const source of sources) {
    console.log(`  - ${source.source_key}: ${source.root_path}`);
  }

  // Get env config info
  console.log(`\nConfiguration:`);
  console.log(`  RAG_ENABLED: ${process.env.RAG_ENABLED || "true"}`);
  console.log(`  RAG_EMBEDDINGS_ENABLED: ${process.env.RAG_EMBEDDINGS_ENABLED || "false"}`);
  console.log(`  RAG_EMBEDDING_MODEL: ${process.env.RAG_EMBEDDING_MODEL || "nomic-embed-text"}`);
  console.log(`  RAG_CHUNK_SIZE: ${process.env.RAG_CHUNK_SIZE || "1200"}`);
  console.log(`  RAG_TOP_K: ${process.env.RAG_TOP_K || "8"}`);

  db.close();
  console.log("\n✓ RAG system is ready");
} catch (error) {
  console.error("[RAG] Error reading RAG status:", error);
  process.exit(1);
}
