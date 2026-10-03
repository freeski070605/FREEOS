# FREEOS 1.5 — Project-Specific Agents

Agents are bounded, user-triggered workers. Their workflow is **mission → scope → plan → read → request approval → act → report → audit**. They are not unrestricted autonomous processes. No agent is created or enabled by default, and this phase does not implement the Mission Engine.

## Definition and templates

`packages/agent-core` stores definitions and runs in the existing SQLite database. Each definition has an explicit project list, mission, allowed and denied tools, RAG and approved-memory switches, scheduler permission, response mode, and local Ollama model mode. Ten inactive templates are available: Brand, Content, Growth / Sales, Client, Revenue, Opportunity, Operations, Creative, Coding, and Trading. A user previews a definition and submits a Tool Runner request for creation or mutation. Approval and execution remain separate steps.

## Scope and execution

Run preview checks the enabled agent, selected project, tool list, and structured arguments. A run reads selected project notes, then approved project memory, optional global approved memory, and optional project-indexed RAG results. RAG uses the existing hybrid search and filters document project metadata before context reaches the model. Source metadata in run history is a title and local ID, not a full file path. No reindex occurs. Local Ollama produces the report. The model cannot call tools: only the structured requests supplied in the user-triggered run are considered.

Only tools with an agent scope adapter can be selected. Read-only requests pass through Tool Runner. Actions create pending Tool Runner requests; agents cannot approve them. At execution time, Tool Runner checks that the original run still belongs to an enabled agent, the request ID belongs to that run, and current project/tool permission still allows the action. Tool Runner and subsystem policies remain authoritative. A rejected action cancels the waiting run; completed actions complete it. Runs and context source IDs are persisted in `agent_runs`.

Browser inspection relies on Browser Operator's origin observation grants. Navigation requires both explicit agent permission and normal Browser Operator site permission, control switch, preview, and Tool Runner approval. Form interaction, submission, messaging, publishing, downloading, and purchasing are unavailable to agents in this phase.

Coding Agent is bound to the `freeos` project and the configured FREEOS Safe Coding Workspace root. It may inspect, search, read, view Git status/diffs, and create structured previews. Apply and command execution require the existing preview/approval/run path. Apply requests carry the workspace binding, and execution checks the preview's real workspace again. Other repository roots and unbound coding sessions are unavailable to agents.

Scheduler permission defaults off. A permitted agent can request a schedule creation only for the same project, initially disabled, targeting one of its allowed read-only status tools. The normal Scheduler approval and global opt-in switch still apply. Agents cannot silently enable schedules or create self-replicating schedules.

Trading Agent is analysis-only: market research, scans, strategy and backtest ideas, paper positions, journals, performance and risk analysis, watchlists, and setups. Live orders, money movement, broker execution, financial form submission, and Computer Operator workarounds are blocked globally. Computer control and screen capture retain their independent default-off switches.

## Interfaces

API: `GET /agents/status`, `/templates`, `/`, `/:id`, `/runs`, `/runs/:id`; `POST /agents/preview`, `/run/preview`, `/:id/run`, and `/requests` for pending create/update/enable/disable/delete requests. The shared `/tools/requests/:id/approve` and `/run` routes perform human review and execution. The dashboard Agents panel shows status, templates, creation preview, agent cards, run preview, run history, and waiting approvals.

## Tables

`agent_definitions` and `agent_runs` are created non-destructively with indexes. Delete is a soft delete so run history remains attached. No existing tables are dropped or reindexed.
