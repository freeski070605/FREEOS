#!/usr/bin/env node

import { MemoryStore } from "@freeos/memory-core";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const freeosRoot = process.env.FREEOS_ROOT || resolve(process.cwd());
const documentsDir = join(freeosRoot, "data", "documents");

console.log("[RAG] Initializing RAG system...");
console.log(`[RAG] Documents dir: ${documentsDir}`);

// Ensure data directory exists
mkdirSync(join(freeosRoot, "data"), { recursive: true });

// Ensure documents directory exists
mkdirSync(documentsDir, { recursive: true });

// Initialize MemoryStore which creates all database tables
const memoryStore = new MemoryStore({ rootDir: freeosRoot });
console.log(`[RAG] Database: ${memoryStore.databasePath}`);

try {
  // Get database connection from initialized MemoryStore (tables already created)
  const db = memoryStore.getDatabase();
  db.pragma("foreign_keys = ON");

  // Register default RAG sources
  const sources = [
    {
      sourceKey: "freeos-documents",
      displayName: "FREEOS Documents",
      rootPath: join(freeosRoot, "data", "documents"),
      projectKey: null,
      sourceType: "folder",
    },
    {
      sourceKey: "project-knowledge",
      displayName: "Project Knowledge",
      rootPath: join(freeosRoot, "data", "projects"),
      projectKey: null,
      sourceType: "folder",
    },
    {
      sourceKey: "freeos-docs",
      displayName: "FREEOS Docs",
      rootPath: join(freeosRoot, "docs"),
      projectKey: null,
      sourceType: "folder",
    },
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO rag_sources (source_key, project_key, source_type, root_path, display_name)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const source of sources) {
    stmt.run(
      source.sourceKey,
      source.projectKey,
      source.sourceType,
      source.rootPath,
      source.displayName,
    );
    console.log(`[RAG] Registered source: ${source.sourceKey}`);
  }

  console.log("[RAG] ✓ RAG system initialized successfully");
} catch (error) {
  console.error("[RAG] Error initializing RAG:", error);
  process.exit(1);
}
