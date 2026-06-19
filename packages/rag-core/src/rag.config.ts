import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface RagConfig {
  enabled: boolean;
  documentsDir: string;
  allowedRoots: string[];
  excludedGlobs: string[];
  chunkSize: number;
  chunkOverlap: number;
  maxFileSizeMb: number;
  embeddingsEnabled: boolean;
  embeddingProvider: "ollama" | "local" | "none";
  embeddingModel: string;
  topK: number;
}

function findFreeosRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    try {
      const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: string };
      if (packageJson.name === "freeos") return current;
    } catch {
      // Keep walking up until the repository root is found.
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function getRagConfig(): RagConfig {
  const freeosRoot = process.env.FREEOS_ROOT ?? findFreeosRoot();

  const enabled = process.env.RAG_ENABLED === "true";
  const documentsDir = resolve(freeosRoot, process.env.RAG_DOCUMENTS_DIR ?? "data/documents");
  
  const allowedRootsEnv = process.env.RAG_INDEX_ALLOWED_ROOTS ?? "data/documents,data/projects,docs";
  const allowedRoots = allowedRootsEnv
    .split(",")
    .map((root) => resolve(freeosRoot, root.trim()))
    .filter((root) => root);

  const excludedGlobsEnv = process.env.RAG_EXCLUDED_GLOBS ?? 
    "node_modules,.git,dist,build,.env,*.sqlite,*.db,*.bin,*.gguf,*.wav,*.webm,*.mp3,*.mp4,exports/backups,services/whispercpp,services/searxng";
  const excludedGlobs = excludedGlobsEnv.split(",").map((g) => g.trim()).filter(Boolean);

  const chunkSize = parseInt(process.env.RAG_CHUNK_SIZE ?? "1200", 10);
  const chunkOverlap = parseInt(process.env.RAG_CHUNK_OVERLAP ?? "150", 10);
  const maxFileSizeMb = parseInt(process.env.RAG_MAX_FILE_SIZE_MB ?? "5", 10);

  const embeddingsEnabled = process.env.RAG_EMBEDDINGS_ENABLED === "true";
  const embeddingProvider = (process.env.RAG_EMBEDDING_PROVIDER ?? "ollama") as "ollama" | "local" | "none";
  const embeddingModel = process.env.RAG_EMBEDDING_MODEL ?? "nomic-embed-text";
  const topK = parseInt(process.env.RAG_TOP_K ?? "8", 10);

  return {
    enabled,
    documentsDir,
    allowedRoots,
    excludedGlobs,
    chunkSize,
    chunkOverlap,
    maxFileSizeMb,
    embeddingsEnabled,
    embeddingProvider,
    embeddingModel,
    topK,
  };
}
