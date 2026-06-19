# FREEOS v1 Release Notes

Release: **FREEOS 1.0.0 — Command Center v1**  
Phase: **6**  
Status: **Stable local release**

## Summary

FREEOS v1 unifies a local AI brain, human-approved memory, project knowledge, web research, push-to-talk voice, safe tools, manual automations, approvals, activity, and backup/export in one Command Center. It is designed to remain useful when optional local services are offline.

## Completed phases

1. Local Brain Foundation
2. Local Memory + Project Knowledge
3. Web Research with SearXNG
4. Voice Input/Output
5. Safe Tool Runner + Local Automations
6. FREEOS Command Center

## What works

- Local chat through Ollama with approved memory and selected project notes.
- Memory proposals with explicit approve/reject decisions.
- Local project notes and project folders.
- SearXNG search, bounded page reading, local summaries, and explicit saves.
- Push-to-talk recording, optional whisper.cpp transcription, and optional local TTS.
- Registered read-only and approval-gated write tools.
- Manual/preview automation rules without a background scheduler.
- Unified approvals, activity history, status, and timestamped backups.
- Environment, SQLite integrity, backup, smoke, and unified release checks.

## Safety rules

- Dangerous and high-risk actions are disabled.
- Write tools require approval and a separate run click.
- Chat does not execute tools.
- Memory is not auto-approved.
- Voice does not authorize actions and never listens continuously.
- Automations do not run in the background.
- Credentials and `.env` content are excluded from backups.

## No-paid-key strategy

FREEOS uses local Ollama for AI, local SQLite for state, optional self-hosted SearXNG for search, and optional local speech engines. No paid API key or cloud AI provider is required or enabled.

## Known limitations

- Ollama must be running for chat and local summarization.
- SearXNG must be running for web search; archived local research remains available otherwise.
- Speech-to-text and text-to-speech require their selected local engines and paths.
- Browser microphone permission is required to record.
- There is no scheduler, vector document index, remote access, or mobile client in v1.
- The release check can only run endpoint smoke tests while the API is online.

## Recommended next upgrades

Start with RAG/document indexing, then add project-specific agents. Follow with an explicitly opt-in scheduler, Alienware GPU optimization, and secure remote/mobile access. Preserve local-first operation, approvals, auditability, and hard safety blocks throughout.
