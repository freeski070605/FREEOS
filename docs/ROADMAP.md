# FREEOS Roadmap

FREEOS v1.0.0 is complete and stable. Phases 1–6 culminated in Command Center v1.

## Completed v1 track

- [x] Phase 1 — Local Brain Foundation
- [x] Phase 2 — Local Memory + Project Knowledge
- [x] Phase 3 — Web Research with SearXNG
- [x] Phase 4 — Voice Input/Output
- [x] Phase 5 — Safe Tool Runner + Local Automations
- [x] Phase 6 — FREEOS Command Center
- [x] v1 hardening — versioning, smoke tests, environment/database/backup verification, resilient UI states, and release documentation

## Forward upgrade track

1. **RAG stabilization** - ingestion reliability, retrieval quality, grounded answers, and explicit local indexing controls.
2. **Computer Operator** - FREEOS 1.1 foundation: typed Windows observation, opt-in local screenshots, approved focus/input/app launch, centralized control lock, and audit. No autonomous loop. Broader application permissions, UI Automation, and an in-flight emergency stop remain future work.
3. **Safe Coding Workspace** - completed in FREEOS 1.2: registered roots, protected reads and search, structured change previews, Tool Runner approval, touched-file snapshots, hash-guarded rollback, and approved verification commands. Build, coding and Computer Operator tests, database integrity, environment check, RAG status, and API smoke tests passed.
4. **Browser Operator** - FREEOS 1.3 foundation: isolated local browser profile, explicit site permissions, page inspection, Tool Runner approved actions, and blocked high-impact categories. See `BROWSER_OPERATOR.md`.
5. **Opt-in Scheduler** - completed in FREEOS 1.4: structured schedules, preview, approval, SQLite audit, and global off switch; no default background autonomy. Full build and targeted scheduler tests passed. See `OPT_IN_SCHEDULER.md`.
6. **Project-Specific Agents** - agents limited to selected project context and permissions.
7. **Mission Engine** - user-defined objectives and constraints, bounded task planning, approvals, measurable progress, and audit.
8. **Resource / Model Manager** - local model routing, Alienware GPU optimization, inference/transcription/indexing resource budgets, and local health.
9. **Secure Remote / Mobile Access** - authentication, least privilege, and local kill switches before remote control.

## Mission Engine objective

"Build the DFB brand, grow sustainable revenue, create leverage, and reduce repetitive work while operating within explicit user-defined permissions."

Planned specialized agents (none implemented by the Computer Operator foundation):

- Brand Agent
- Content Agent
- Growth / Sales Agent
- Client Agent
- Revenue Agent
- Opportunity Agent
- Operations Agent
- Creative Agent
- Coding Agent
- Trading Agent

### Trading Agent (planned)

Responsibilities: market research, market scanning, strategy research, backtesting, paper trading, trade journaling, performance analytics, risk analytics, watchlists, and setup detection.

**Live-money execution is NOT enabled in this phase.** Future live execution must use a separate controlled subsystem with:

- explicit opt-in;
- approval controls;
- isolated trading bankroll;
- position limits;
- max daily loss;
- symbol/market permissions;
- kill switch;
- immutable audit trail.

The general computer agent must never independently decide to move money or place a trade. Approving generic mouse or keyboard access does not authorize financial execution.

Cloud AI providers, paid API requirements, destructive actions, always-on listening, chat-driven tool execution, and automatic memory approval remain outside the default FREEOS design.
