# FREEOS Architecture

FREEOS is a local-first Node.js/TypeScript monorepo. Express runs on port 3001, React/Vite on 5173, and SQLite state lives in `data/freeos.sqlite`.

## Capability layers

- `memory-core`: schema, projects, notes, approved memory, and memory approval transitions.
- `research-core`: SearXNG search, bounded page reading, sources, local Ollama summaries, and research persistence.
- `voice-core`: local recording storage, voice sessions, whisper.cpp STT, Piper or Windows TTS, and voice configuration.
- `tool-runner`: tool registry, risk classification, approval queue, execution logs, path policy, safe executors, and automation rules.
- `computer-core`: typed local Windows observation, PNG capture, validated window/input operations, application allowlist, and centralized control policy. It has no cloud or native npm dependency.
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

## FREEOS 1.1 Computer Operator Foundation

```text
Brain (local Ollama)
  -> Agent/Planner layer (future)
  -> Tool approval layer (request -> inspect -> approve -> run -> log)
  -> Computer Operator (computer-core)
  -> Windows
```

Computer Operator is a capability layer, not an autonomous decision-maker. There is no background loop, scheduler, coding agent, browser agent, screen-vision model, or trading implementation in this phase. Chat can propose requests but cannot approve or run controls.

The adapter runs a checked-in PowerShell file with `-NoProfile -NonInteractive`, hidden windows, bounded output, and a timeout. Request arguments travel as JSON over stdin and are never substituted into script source. Windows Forms supplies physical monitor bounds and local screen capture; fixed user32 interop supplies visible windows, focus, and Unicode input. Only explicit structured operations exist. Processes expose IDs, names, and window titles, never command lines or environment blocks.

`GET /computer/status`, `/computer/windows`, `/computer/active-window`, and `/computer/processes` use the same read-only tool executor and audit trail. Capture uses `computer.screen.capture` through `/tools/run-readonly`. All seven control tools use existing tool request, approve, and run routes. The Computer dashboard panel prepares requests and reuses the Approval Hub, which displays exact arguments before approval. The server remains authoritative.

The single control decision is `isComputerControlAllowed()` in computer-core policy, evaluated at execution time. The native adapter also checks the inherited switch before input. The independent capture switch gates screenshot operations. Both default to false; missing settings never opt in. A future global emergency stop can extend the central policy. This phase does not install a global keyboard hook or provide an in-flight stop UI.

Screenshots are PNGs in `generated/computer/screenshots/`. Retention keeps the newest 20 strictly named FREEOS captures and rejects redirected directories. Screenshots are not served through an unrestricted static route. Typed text is held only in API memory for review; SQLite stores a redaction and character count. Restarting the API expires pending typed payloads. Tool requests and run IDs retain their existing SQLite relationships; concurrent or repeated runs cannot claim the same approved request twice.

The foundation application policy permits trusted Windows Notepad, Calculator, and Paint targets. Launch accepts only their exact System32 executable paths and an explicit empty argument array. Broader applications and arguments require a reviewed policy extension. This intentionally small allowlist prevents input into terminals, browsers, file managers, and credential windows. Packaged Windows applications may refuse launch or focus in some sessions; failures are surfaced rather than simulated.

The long-term operator should be hybrid: direct OS/filesystem APIs for reliable structured work; Windows UI Automation for accessible controls; keyboard/mouse only as a fallback; screen vision and browser automation in later, separately governed layers. This reduces coordinate fragility and makes targets and effects more inspectable. This foundation adds no screen-vision AI.
