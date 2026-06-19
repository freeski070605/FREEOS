import { Router, Request, Response } from "express";
import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { getRagConfig } from "@freeos/rag-core";
import { RagService } from "@freeos/rag-core";
import { readFileSync } from "node:fs";

let db: Database.Database;

// Find FREEOS root
function findFreeosRoot(start = process.cwd()): string {
  let current = start;
  while (true) {
    try {
      const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: string };
      if (packageJson.name === "freeos") return current;
    } catch {
      // Keep walking up
    }
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

// Initialize database on first use
function getDb(): Database.Database {
  if (!db) {
    const freeosRoot = process.env.FREEOS_ROOT ?? findFreeosRoot();
    const dbPath = join(freeosRoot, "data", "freeos.sqlite");
    db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export const ragRouter = Router();

const config = getRagConfig();
let ragService: RagService;

function getRagService(): RagService {
  if (!ragService) {
    ragService = new RagService(config, getDb());
  }
  return ragService;
}

// GET /rag/status
ragRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const service = getRagService();
    const status = await service.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// GET /rag/sources
ragRouter.get("/sources", (_req: Request, res: Response) => {
  try {
    const service = getRagService();
    const sources = service.listSources();
    res.json(sources);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// POST /rag/sources
ragRouter.post(
  "/sources",
  async (req: Request, res: Response) => {
    try {
      const { sourceKey, displayName, rootPath, projectKey, sourceType } = req.body;

      if (!sourceKey || !displayName || !rootPath) {
        res.status(400).json({ error: "sourceKey, displayName, and rootPath are required" });
        return;
      }

      const service = getRagService();
      const source = service.createSource(
        sourceKey,
        displayName,
        rootPath,
        projectKey,
        sourceType || "folder",
      );

      res.status(201).json(source);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
);

// POST /rag/index
ragRouter.post("/index", async (req: Request, res: Response) => {
  try {
    const { rootPath, projectKey, sourceKey, force, embeddings } = req.body;

    const service = getRagService();
    const job = await service.indexFolder(
      rootPath || config.documentsDir,
      projectKey,
      sourceKey,
      force || false,
      embeddings !== undefined ? embeddings : config.embeddingsEnabled,
    );

    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// GET /rag/documents
ragRouter.get("/documents", (_req: Request, res: Response) => {
  try {
    const projectKey = _req.query.projectKey as string | undefined;
    const service = getRagService();
    const documents = service.listDocuments(projectKey);
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// GET /rag/documents/:id/chunks
ragRouter.get("/documents/:id/chunks", (_req: Request, res: Response) => {
  try {
    const documentId = Number(_req.params.id);
    if (Number.isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }

    const service = getRagService();
    const chunks = service.getDocumentChunks(documentId);
    res.json(chunks);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// POST /rag/search
ragRouter.post("/search", async (req: Request, res: Response) => {
  try {
    const { query, projectKey, mode, topK } = req.body;

    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    const service = getRagService();
    const results = await service.search(query, mode || "keyword", projectKey, topK);

    res.json({ results, count: results.length });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// POST /rag/context
ragRouter.post("/context", async (req: Request, res: Response) => {
  try {
    const { query, projectKey, topK, includeMemory, includeProjectNotes, includeDocuments } = req.body;

    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    const service = getRagService();
    const context = await service.buildContext(
      query,
      projectKey,
      topK || config.topK,
      includeMemory !== false,
      includeProjectNotes !== false,
      includeDocuments !== false,
    );

    res.json(context);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// POST /rag/documents/:id/reindex
ragRouter.post("/documents/:id/reindex", async (req: Request, res: Response) => {
  try {
    const documentId = Number(req.params.id);
    if (Number.isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }

    const db = getDb();
    const doc = db.prepare("SELECT file_path FROM rag_documents WHERE id = ?").get(documentId) as Record<string, unknown> | undefined;

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const service = getRagService();
    const indexed = await service.indexFile(
      String(doc.file_path),
      undefined,
      undefined,
      true,
      req.body?.embeddings || config.embeddingsEnabled,
    );

    res.json({ indexed });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// DELETE /rag/documents/:id/index
ragRouter.delete("/documents/:id/index", (_req: Request, res: Response) => {
  try {
    const documentId = Number(_req.params.id);
    if (Number.isNaN(documentId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }

    const service = getRagService();
    service.deleteDocumentIndexOnly(documentId);

    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});
