# FREEOS Architecture

FREEOS is a local-first Node.js/TypeScript monorepo. Express runs on port 3001, React/Vite on 5173, and SQLite state lives in `data/freeos.sqlite`.

## Capability layers

- `memory-core`: schema, projects, notes, approved memory, and memory approval transitions.
- `research-core`: SearXNG search, bounded page reading, sources, local Ollama summaries, and research persistence.
- `voice-core`: local recording storage, voice sessions, whisper.cpp STT, Piper or Windows TTS, and voice configuration.
- `tool-runner`: tool registry, risk classification, approval queue, execution logs, path policy, safe executors, and automation rules.
- API server: exposes each capability without moving permission decisions into the browser.
- Dashboard: presents status, registries, queues, histories, and explicit controls.

## Phase 5 action flow

```text
read-only selection → permission check → executor → tool_runs + system_events

write/action proposal → tool_requests (pending) → human approve/reject
approved request → permission re-check → allowlisted executor → tool_runs + system_events

automation check → read-only run OR pending tool request
```

The tool registry is the source of capability metadata, but registry state alone is not authorization. The executor re-checks enabled state, risk level, request status, path boundaries, and script allowlists at execution time.

Tool state uses `tool_registry`, `tool_requests`, and `tool_runs`. Automation state uses `automation_rules` and `automation_events`. Both layers also append audit summaries to `system_events`.

## Deny-first boundaries

Direct execution is limited to enabled `read_only` tools. Writes require approval. Medium-risk scripts are preview-first and restricted to a fixed allowlist under `tools/scripts`. High-risk tools are disabled and have no implementation. File creation is constrained to FREEOS-owned folders using resolved-path containment checks.

Voice input remains data, not authorization. It has no route that approves or runs tool requests.

## Phase 6 Command Center layer

`/command/status` is a read-only aggregator over the existing subsystem services. The local chat bridge sends prompts only to Ollama and builds context from approved memories and explicitly selected project notes. It records sessions in `command_chat_sessions`.

The Approval Hub combines pending `memory_proposals` and `tool_requests`; it does not weaken either subsystem's transition rules. The Activity Timeline normalizes local events from system, memory, research, voice, tool, automation, chat, and backup tables.

The backup/export service creates timestamped folders and manifests under `exports/backups/`, using SQLite's backup operation for a consistent database copy. `backup_events` records completed API backups. The API remains the permission boundary; the dashboard only presents explicit controls.
