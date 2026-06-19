# Tools and Automations

## Overview

Phase 5 gives FREEOS a local tool registry, a human approval queue, execution logs, and simple manual automation rules. The server—not the dashboard—enforces risk policy.

## Default tools

Read-only: `system.status.snapshot`, `projects.list`, `memory.status`, `research.status`, and `voice.status`.

Approval-based writes: `notes.create_project_note`, `memory.create_proposal`, and `files.create_freeos_text_file`.

Medium-risk: `scripts.run_freeos_script`. It accepts only a filename on the internal allowlist; Phase 5 initially allows `tools-status.js`.

Blocked examples: `files.delete`, `email.send`, `trade.place_order`, `deploy.production`, `purchase.make`, and `credentials.read`. These are disabled and have no execution implementation.

## Approval flow

1. Create a request with `POST /tools/requests`.
2. Inspect its tool, risk, description, and exact JSON args.
3. Approve with `POST /tools/requests/:id/approve`, or reject it.
4. Run an approved request with `POST /tools/requests/:id/run`.
5. Inspect the result in `GET /tools/runs`.

Approval does not execute by default. `executeNow: true` is supported by the approval endpoint when an explicit combined action is desired.

## Examples

Run a read-only status snapshot:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/tools/run-readonly -Method Post -ContentType application/json -Body '{"toolKey":"system.status.snapshot"}'
```

Create a pending memory-proposal request:

```json
{
  "toolKey": "memory.create_proposal",
  "title": "Test memory proposal tool",
  "args": {
    "title": "Tool runner test",
    "content": "FREEOS can create pending memory proposals through approved tool requests.",
    "category": "system",
    "tags": ["phase5", "tool-runner"]
  }
}
```

When this approved tool runs, it creates a pending memory proposal—not approved memory.

## Automation rules

Rules use `manual` or `interval_preview` triggers. They are created disabled. Enable a rule, then call `POST /automations/:ruleKey/check`. A read-only action may run and be logged. Any write or medium-risk action becomes a pending tool request. There is no background scheduler in Phase 5.

## Safety notes

High-risk requests return a clear denial. File writes remain under approved FREEOS folders, deletes are unavailable, and voice commands cannot run tools or provide approval.
