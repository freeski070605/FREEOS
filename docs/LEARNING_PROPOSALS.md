# FREEOS Learning Proposals

Status: Foundation implemented

## Purpose

FREEOS may notice potentially useful long-term knowledge while working, but it must not silently turn observations into durable memory. A Learning Proposal is the approval boundary between temporary reasoning and durable learning.

Core rule:

> FREEOS may decide what is worth learning. Drew decides what becomes durable knowledge.

## Lifecycle

```text
AUTHORIZED INFORMATION
        ↓
TEMPORARY TASK USE
        ↓
POTENTIAL LONG-TERM VALUE DETECTED
        ↓
LEARNING PROPOSAL
        ↓
DREW: APPROVE / EDIT / REJECT
        ↓
APPROVED DURABLE MEMORY
```

Approval creates durable memory. Rejection does not. Editing creates an auditable superseding proposal rather than silently rewriting history.

## Required proposal meaning

A useful Learning Proposal should communicate:

- `noticed` — what FREEOS observed that triggered the proposal
- `proposedKnowledge` — the exact durable knowledge FREEOS wants to retain
- `whyItMatters` — why remembering it could improve future behavior
- `scope` — where the knowledge should apply
- `sensitivity` — how carefully the knowledge must be handled
- `confidence` — how strongly the evidence supports it
- `projectKey` — project scope when applicable
- `source` — where the candidate learning came from
- optional user/domain tags

## Scope values

- `global`
- `project`
- `client`
- `business`
- `personal`

Project-scoped learning should also carry a valid `projectKey` whenever one exists.

## Sensitivity values

- `public`
- `internal`
- `project-restricted`
- `private`
- `secret-credential`

`secret-credential` is intentionally blocked from normal durable Learning Proposals. Raw passwords, API keys, recovery codes, private keys, and similar secrets belong in a credential store. FREEOS may learn non-secret metadata such as what a credential is for and where it is stored.

## Confidence values

- `confirmed`
- `high`
- `moderate`
- `low`
- `unverified`
- `disputed`

Confidence is evidence strength, not writing tone.

## API

Base path: `/learning`

### Status

`GET /learning/status`

Returns whether the Learning Proposal layer is enabled, pending/rejected counts, approved-memory count, and supported metadata values.

### List proposals

`GET /learning/proposals?status=pending`

Status may be `pending`, `approved`, or `rejected`.

### Create proposal

`POST /learning/proposals`

Example:

```json
{
  "title": "Drew prefers concise default responses",
  "noticed": "Drew repeatedly corrected responses that were unnecessarily long.",
  "proposedKnowledge": "Default to concise answers for routine tasks and go deeper for strategy, architecture, money, risk, legal, and major decisions.",
  "whyItMatters": "This reduces owner friction while preserving depth where consequences are higher.",
  "scope": "global",
  "sensitivity": "internal",
  "confidence": "high",
  "category": "preference",
  "source": "learning-engine",
  "tags": ["communication"]
}
```

Creation never creates approved durable memory.

### Edit / revise

`POST /learning/proposals/:id/revise`

The original pending proposal is rejected and a revised pending proposal is created with `supersedes-proposal:<id>` metadata. This preserves the audit trail.

### Approve

`POST /learning/proposals/:id/approve`

Approval promotes the proposal into the existing approved-memory store.

### Reject

`POST /learning/proposals/:id/reject`

Rejection preserves the proposal history but creates no durable memory.

## Storage compatibility

Learning Proposals currently build on FREEOS's existing `memory_proposals` table rather than creating a competing knowledge store. Structured metadata is represented through normalized proposal fields plus reserved tags:

- `learning-proposal`
- `scope:<value>`
- `sensitivity:<value>`
- `confidence:<value>`
- optional short `noticed:<text>`
- `supersedes-proposal:<id>` after revision

This keeps the v1 implementation backward-compatible with the existing approval hub and memory system. A later Knowledge Governance phase may migrate these fields into typed database columns when provenance, supersession, freshness, and conflict handling are implemented more broadly.

## What this foundation does not do yet

This API creates the approval boundary and structured proposal format. It does **not yet** mean FREEOS automatically notices every useful lesson. Automatic candidate detection from conversations, agent outcomes, research, project work, and failures is the next layer.

The intended sequence remains:

1. Learning Proposal foundation
2. automatic candidate detection
3. Experience Learning
4. Knowledge Governance
5. Continuous Learning Engine
6. Mission Engine v1
