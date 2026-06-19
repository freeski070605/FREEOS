# FREEOS RAG & Documents

## What is RAG in FREEOS?

RAG stands for **Retrieval Augmented Generation**. In FREEOS, RAG enables the system to:

- **Read** local documents and project files
- **Chunk** content into manageable pieces
- **Index** text with optional local embeddings
- **Search** using keyword matching or semantic similarity
- **Retrieve** relevant chunks to augment chat context
- **Generate** answers based on indexed knowledge

RAG is **local-first**: all documents stay on your machine. No cloud services, paid APIs, or external embeddings are required.

## Allowed Document Roots

By default, RAG can index from these locations:

- `data/documents` — General documents and knowledge
- `data/projects` — Project-specific files and notes  
- `docs` — FREEOS documentation and architecture

You can add custom sources via the `/rag/sources` API endpoint.

## Supported File Types

RAG indexes these file types:

- `.txt` — Plain text
- `.md`, `.markdown` — Markdown
- `.json` — JSON documents
- `.csv` — Comma-separated values
- `.ts`, `.tsx` — TypeScript
- `.js`, `.jsx` — JavaScript
- `.py` — Python
- `.html` — HTML
- `.css` — CSS
- `.yml`, `.yaml` — YAML configuration

Other files (PDF, DOCX, images, binaries, etc.) are skipped and logged.

## What Gets Excluded?

RAG **never indexes**:

- `node_modules`, `.git`, `dist`, `build` directories
- `.env` files and credentials
- SQLite databases (`.sqlite`, `.db`)
- Model files (`.gguf`, `.bin`)
- Audio/video files (`.wav`, `.webm`, `.mp3`, `.mp4`)
- `exports/backups`, `services/whispercpp`, `services/searxng`
- Files larger than `RAG_MAX_FILE_SIZE_MB` (default 5 MB)

This ensures secrets, model files, and large build artifacts are never scanned or indexed.

## How Chunking Works

When a file is indexed:

1. **Extract text** from the file
2. **Split into chunks** of configurable size (default 1200 characters)
3. **Overlap chunks** by a small amount (default 150 characters) for context preservation
4. **Estimate tokens** for each chunk (rough: 1 token ≈ 4 characters)
5. **Hash chunks** to detect changes
6. **Store in SQLite** with metadata

This approach balances context preservation with search efficiency.

## Search Modes

### Keyword Search (Always Works)

Uses SQLite LIKE queries to find chunks matching keywords from your query. Fast, reliable, no setup required.

**Example:**
```bash
curl -X POST http://127.0.0.1:3001/rag/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "local-first architecture",
    "mode": "keyword",
    "topK": 5
  }'
```

### Hybrid Search (Keyword + Embeddings)

Falls back to keyword search if embeddings are not available. If Ollama and an embedding model are configured, uses semantic similarity for more intelligent ranking.

### Embeddings Search (Full Semantic)

Requires:
- Ollama running locally
- An embedding model installed (e.g., `nomic-embed-text`)
- `RAG_EMBEDDINGS_ENABLED=true`

Returns results ranked by semantic similarity.

## Optional Local Embeddings

### Installing an Embedding Model

Pull a local embedding model via Ollama:

```bash
ollama pull nomic-embed-text
```

Or try `mxbai-embed-large` for larger context:

```bash
ollama pull mxbai-embed-large
```

### Enabling Embeddings

Set environment variables:

```
RAG_EMBEDDINGS_ENABLED=true
RAG_EMBEDDING_PROVIDER=ollama
RAG_EMBEDDING_MODEL=nomic-embed-text
```

Then restart the API:

```bash
npm run dev:api
```

### Indexing with Embeddings

When indexing, embeddings are created automatically if enabled:

```bash
npm run rag:index -- data/documents
```

Or via API:

```bash
curl -X POST http://127.0.0.1:3001/rag/index \
  -H "Content-Type: application/json" \
  -d '{
    "rootPath": "data/documents",
    "embeddings": true
  }'
```

## Using RAG in Chat

In the Command Center chat, enable RAG:

```bash
curl -X POST http://127.0.0.1:3001/command/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is FREEOS designed for?",
    "useRag": true,
    "ragMode": "keyword",
    "ragTopK": 8
  }'
```

The response includes:

```json
{
  "response": "...",
  "ragUsed": true,
  "ragSources": [
    {
      "documentPath": "data/documents/freeos-intro.md",
      "documentName": "freeos-intro.md",
      "chunks": [0, 2, 5]
    }
  ]
}
```

## API Endpoints

### GET `/rag/status`

Get RAG configuration and stats.

**Response:**
```json
{
  "enabled": true,
  "documentsDir": "/path/to/data/documents",
  "allowedRoots": [...],
  "embeddingsEnabled": false,
  "embeddingModel": "nomic-embed-text",
  "indexedDocumentCount": 12,
  "chunkCount": 487,
  "embeddingCount": 0,
  "lastIndexJob": {
    "status": "completed",
    "filesIndexed": 12,
    "chunksCreated": 487
  }
}
```

### GET `/rag/sources`

List registered RAG sources.

### POST `/rag/sources`

Register a new RAG source:

```bash
curl -X POST http://127.0.0.1:3001/rag/sources \
  -H "Content-Type: application/json" \
  -d '{
    "sourceKey": "custom-docs",
    "displayName": "My Custom Documentation",
    "rootPath": "/absolute/path/to/docs",
    "projectKey": "personal"
  }'
```

### POST `/rag/index`

Index a folder (or rescan):

```bash
curl -X POST http://127.0.0.1:3001/rag/index \
  -H "Content-Type: application/json" \
  -d '{
    "rootPath": "data/documents",
    "force": false,
    "embeddings": false
  }'
```

**Response:**
```json
{
  "status": "completed",
  "filesSeen": 15,
  "filesIndexed": 12,
  "chunksCreated": 487,
  "errors": []
}
```

### GET `/rag/documents`

List indexed documents.

**Query params:**
- `projectKey` — Filter by project

### GET `/rag/documents/:id/chunks`

Get all chunks for a document.

### POST `/rag/search`

Search indexed documents.

**Body:**
```json
{
  "query": "local-first command system",
  "mode": "keyword",
  "topK": 5
}
```

### POST `/rag/context`

Build a full context block from documents for use in prompts.

**Body:**
```json
{
  "query": "FREEOS architecture",
  "topK": 8,
  "includeMemory": false,
  "includeProjectNotes": false,
  "includeDocuments": true
}
```

### POST `/rag/documents/:id/reindex`

Reindex a single document.

### DELETE `/rag/documents/:id/index`

Remove index records only. **Does not delete the source file.**

## Scripts

### Initialize RAG

```bash
npm run init:rag
```

Creates:
- `data/documents` directory
- Default RAG sources in the database

### Check RAG Status

```bash
npm run rag:status
```

Displays:
- Document count
- Chunk count
- Embedding count
- Last index job
- Configuration

### Index Documents

```bash
npm run rag:index -- data/documents
```

Indexes all supported files in the specified path.

## Environment Variables

```
# Enable RAG system
RAG_ENABLED=true

# Document directory
RAG_DOCUMENTS_DIR=data/documents

# Allowed indexing roots (comma-separated, relative to FREEOS root)
RAG_INDEX_ALLOWED_ROOTS=data/documents,data/projects,docs

# Excluded glob patterns
RAG_EXCLUDED_GLOBS=node_modules,.git,dist,build,.env,*.sqlite,*.db,*.bin,*.gguf,*.wav,*.webm,*.mp3,*.mp4,exports/backups,services/whispercpp,services/searxng

# Chunk configuration
RAG_CHUNK_SIZE=1200
RAG_CHUNK_OVERLAP=150
RAG_MAX_FILE_SIZE_MB=5

# Embeddings
RAG_EMBEDDINGS_ENABLED=false
RAG_EMBEDDING_PROVIDER=ollama
RAG_EMBEDDING_MODEL=nomic-embed-text

# Search
RAG_TOP_K=8
```

## Safety Rules

1. **RAG does not scan the whole computer.** Only allowed roots are indexed.
2. **Secrets are never indexed.** `.env` files and credential patterns are excluded.
3. **Model files are never indexed.** `.gguf`, `.bin`, and other large model files are skipped.
4. **Source files are never deleted.** Only index records can be removed via `DELETE /rag/documents/:id/index`.
5. **No automatic memory approval.** Document content is used for context, not automatically saved as memory.
6. **No cloud dependencies.** All indexing and search happen locally.

## Known Limitations

- **PDF and DOCX not supported yet.** Can be added in future versions if safe parsers are available.
- **Embeddings are optional.** The system works perfectly well with keyword search alone.
- **No custom chunking strategies yet.** Future versions may support semantic chunking or domain-specific splitting.
- **No document clustering or tagging** beyond project association.

## Troubleshooting

### "RAG disabled" error

Set `RAG_ENABLED=true` in your `.env` file and restart the API.

### No documents indexed

1. Check that files are in allowed roots (`data/documents`, `data/projects`, `docs`)
2. Verify file extensions are supported (`.md`, `.txt`, `.ts`, etc.)
3. Ensure files are not in excluded directories (`node_modules`, `.git`, etc.)
4. Run `npm run rag:status` to see the count

### Embeddings not working

1. Start Ollama: `ollama serve`
2. Install model: `ollama pull nomic-embed-text`
3. Set `RAG_EMBEDDINGS_ENABLED=true`
4. Restart API: `npm run dev:api`

## Next Steps

- **Semantic search** — Rank results by vector similarity instead of keyword matches
- **PDF parsing** — Add support for `.pdf` and `.docx` if safe libraries emerge
- **Document metadata** — Extract and store author, created date, version info
- **Project agents** — Create RAG-backed agents for specific projects
- **Memory integration** — Auto-link indexed documents to approved memories
- **Full-text search** — Use SQLite FTS5 for faster keyword matching
