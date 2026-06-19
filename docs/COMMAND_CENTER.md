# FREEOS Command Center

Phase 6 makes the dashboard the main operating surface for free-os. The sidebar exposes Command Center, Chat, Memory, Projects, Research, Voice, Tools, Automations, Activity, and Settings / Backup.

The home screen aggregates local service status, pending approvals, recent activity, quick notes, and safe shortcuts. Chat sends prompts only to local Ollama and may use approved memories and selected project notes. It never approves memory or executes tools. A remember request creates a pending proposal; a recognized write-tool request may create a pending tool request.

The Approval Hub combines memory proposals and tool requests. Tool approval and execution are separate actions. The Activity Timeline reads the local SQLite audit tables and can be refreshed manually.

Backups are timestamped, non-overwriting local exports. See [BACKUP_AND_EXPORT.md](BACKUP_AND_EXPORT.md) for inclusions, exclusions, and restore steps.

Safety boundaries remain fixed: no paid API keys, cloud AI, destructive actions, automatic sending, purchases, trading, deployments, hidden commands, always-on microphone, automatic memory approval, or voice-triggered execution. High-risk tools remain blocked.
