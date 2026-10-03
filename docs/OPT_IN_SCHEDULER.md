# FREEOS 1.4 Opt-in Scheduler

The scheduler is local and defaults off. Set `SCHEDULER_ENABLED=true` in the root `.env` and restart the API to opt in. The runtime pause control stops new scheduled work; it does not interrupt an operation already running. The environment switch remains authoritative, so Resume cannot override `SCHEDULER_ENABLED=false`.

## Workflow

DEFINE → PREVIEW → APPROVE → SCHEDULE → EXECUTE / REQUEST APPROVAL → VERIFY → AUDIT.

The dashboard accepts structured one-time, interval, daily, and weekly times. Daily and weekly schedules use the machine's local time zone. Persisted occurrence and next-run timestamps are ISO UTC. Schedule creation, update, enable/disable, deletion, pause, and resume are medium-risk Tool Runner requests. A request must be approved and separately run through the Approval Hub. Chat may suggest or prepare a proposal only; it cannot silently create schedules or enable the global switch.

Approved read-only tools can auto-run. Low-risk writes and medium-risk actions create pending Tool Requests at each occurrence. Browser interaction, coding changes and command runs, and computer controls still pass their current Tool Runner and subsystem permissions. High-risk tools are blocked. Creation approval does not grant blanket approval for future writes. Avoid putting credentials or private data in schedule arguments because schedule definitions are stored in SQLite.

## Runtime and persistence

`packages/scheduler-core` stores `scheduler_schedules`, `scheduler_runs`, and `scheduler_runtime_state` in the existing `data/freeos.sqlite`. A unique schedule ID plus occurrence timestamp prevents duplicate claims across restarts. Run history retains the newest `SCHEDULER_MAX_RUN_HISTORY` rows; deleting a schedule retains its history. Every state change and run writes a `system_events` audit entry.

The API starts one bounded poll loop only when globally enabled. Default interval is 60 seconds and default concurrency limit is one. A busy scheduler defers due jobs to later polls. If `SCHEDULER_STARTUP_CATCHUP=false`, startup skips missed occurrences and advances to the next future time without replaying a burst. A one-time event missed while offline becomes inactive. Individual failures are recorded and do not stop the loop. This phase has no distributed worker or Windows Task Scheduler integration.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SCHEDULER_ENABLED` | `false` | Global execution switch |
| `SCHEDULER_POLL_INTERVAL_MS` | `60000` | Poll interval |
| `SCHEDULER_MAX_CONCURRENT_RUNS` | `1` | Maximum active local jobs |
| `SCHEDULER_MAX_RUN_HISTORY` | `500` | Retained scheduler runs |
| `SCHEDULER_STARTUP_CATCHUP` | `false` | Whether to consider missed occurrences on startup |

Read-only routes: `GET /scheduler/status`, `/scheduler/schedules`, `/scheduler/schedules/:id`, `/scheduler/runs`, and `POST /scheduler/preview`. Mutations use `/tools/requests`, approval, and run routes only.
