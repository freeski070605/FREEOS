# FREEOS

**FREEOS — a local-first AI command system.** FREEOS is pronounced “free-os.”

Phases 1–5 are complete. **Phase 6 — FREEOS Command Center is complete.** The dashboard now unifies local chat, approved memory, project knowledge, SearXNG research, voice, safe tools, manual automations, approvals, activity, and backup/export. No paid API keys or cloud AI providers are required.

## Install and run

Requirements: Windows 10/11 and Node.js 20+. Ollama, SearXNG, whisper.cpp, and Piper are optional local services/tools.

```powershell
npm install
Copy-Item .env.example .env
npm run setup:folders
npm run setup:whisper-folders
npm run init:memory
npm run init:voice
npm run init:tools
npm run dev
```

- Dashboard: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:3001>
- Command status: <http://127.0.0.1:3001/command/status>
- Unified approvals: <http://127.0.0.1:3001/command/approvals>
- Unified activity: <http://127.0.0.1:3001/command/activity>

FREEOS still boots when optional STT/TTS engines, Ollama, or SearXNG are unavailable.

## Command Center

The sidebar keeps every existing local module accessible. The home screen shows a unified status snapshot, pending approvals, recent activity, quick notes, and safe shortcuts. Local chat talks only to Ollama, reads only approved memory, and cannot run tools. Remember requests become pending memory proposals. Recognized write actions can become pending tool requests; approval and execution remain separate clicks.

Backup/export creates timestamped, non-overwriting folders under `exports/backups/`. `.env`, dependencies, model files, large service trees, and generated audio are excluded by default.

## Safety model

Read-only tools may run directly. Writes require approval. High-risk deletion, sending, purchasing, trading, deployment, credential, and system actions remain disabled and unimplemented. Voice is push-to-talk and never authorizes execution. Automations are manual/preview only; there is no background scheduler.

## Useful scripts

```powershell
npm run dev
npm run build
npm run command:status
npm run backup:freeos
npm run check:ollama
npm run check:searxng
npm run check:voice
npm run init:memory
npm run init:voice
npm run init:tools
npm run memory:status
npm run research:status
npm run tools:status
```

SQLite lives at `data/freeos.sqlite`. Initialization is additive and idempotent. See [Command Center](docs/COMMAND_CENTER.md), [backup/export](docs/BACKUP_AND_EXPORT.md), [architecture](docs/ARCHITECTURE.md), [phases](docs/PHASES.md), and [security](docs/SECURITY_MODEL.md).
