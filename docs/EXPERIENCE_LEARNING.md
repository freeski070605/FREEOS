# FREEOS Experience Learning

Status: Foundation implemented

## Purpose

Experience Learning turns verified outcomes into candidate lessons without allowing FREEOS to silently rewrite its durable knowledge.

Core rule:

> Experience is evidence. A lesson becomes durable knowledge only after the outcome is real, the cause is understood enough, the scope is clear, and Drew approves the Learning Proposal.

## Lifecycle

```text
EXPECTED RESULT
      ↓
REAL EXECUTION / REAL OUTCOME
      ↓
EXPERIENCE EVENT
      ↓
SUCCESS / PARTIAL / FAILURE / OWNER CORRECTION
      ↓
CAUSE + EVIDENCE
      ↓
CANDIDATE LESSON
      ↓
LEARNING PROPOSAL
      ↓
DREW: APPROVE / EDIT / REJECT
      ↓
APPROVED DURABLE KNOWLEDGE
```

A recorded experience is not automatically a lesson. A candidate lesson is not automatically true. A successful risky action is not automatically good policy.

## Experience event fields

Each event may include:

- `title`
- `expectedResult`
- `actualResult`
- `outcome`
- `cause`
- `evidence`
- `candidateLesson`
- `projectKey`
- `scope`
- `sensitivity`
- `confidence`
- `sourceType`
- `sourceRef`

Supported outcomes:

- `success`
- `partial`
- `failure`
- `owner-correction`

## API

Base path: `/experience`

### Status

`GET /experience/status`

Returns total events, outcome counts, candidate-lesson count, and how many experience events have already produced Learning Proposals.

### List experience

`GET /experience?limit=50`

Optional filters:

- `projectKey`
- `outcome`
- `status`

### Record an experience

`POST /experience`

Example:

```json
{
  "title": "PowerShell StrictMode broke npm.ps1",
  "expectedResult": "The education indexing script should call npm and continue into RAG indexing.",
  "actualResult": "Windows PowerShell failed inside npm.ps1 while Set-StrictMode was active.",
  "outcome": "failure",
  "cause": "The npm PowerShell wrapper referenced a property that was unavailable under inherited StrictMode.",
  "evidence": "The run failed inside C:\\Program Files\\nodejs\\npm.ps1 before the npm command executed.",
  "candidateLesson": "In FREEOS Windows PowerShell scripts that enable Set-StrictMode, invoke npm.cmd instead of npm so the script bypasses npm.ps1 wrapper incompatibilities.",
  "scope": "project",
  "projectKey": "freeos",
  "confidence": "high",
  "sourceType": "manual",
  "sourceRef": "approved-education-index-strictmode"
}
```

A repeated `sourceType` + `sourceRef` is deduplicated.

### Capture recent Tool Runner outcomes

`POST /experience/capture/tool-runs`

Body:

```json
{ "limit": 25 }
```

This imports recent completed, failed, and blocked Tool Runner runs as raw experience evidence. It does **not** infer or approve durable lessons.

### Convert an experience into a Learning Proposal

`POST /experience/:id/propose`

Optional body fields include:

```json
{
  "candidateLesson": "...",
  "whyItMatters": "...",
  "confidence": "high",
  "scope": "project"
}
```

The event is marked `proposal-created`, linked to the Learning Proposal, and remains non-durable until Drew approves the proposal through the existing Learning Proposal flow.

### Close without a lesson

`POST /experience/:id/close`

Use this when an event is real but does not justify reusable durable knowledge.

## Automatic capture

The v1 foundation can import Tool Runner outcomes through the capture endpoint. Tool runs are intentionally stored as compact outcome evidence rather than raw tool output so Experience Learning does not become a second audit log or unnecessarily duplicate sensitive material.

Automatic lesson inference is intentionally more conservative than raw experience capture. FREEOS should not turn every error into a permanent rule. Repeated patterns, clear owner corrections, and well-understood causes are stronger candidates.

## Relationship to Learning Proposals

Experience Learning never bypasses the durable-learning approval boundary.

```text
Experience Event
   ↓
Candidate Lesson
   ↓
Learning Proposal
   ↓
Owner Approval
   ↓
Durable Memory
```

This means FREEOS can become increasingly observant and self-improving without giving itself permission to silently define truth.

## Next phase

After this foundation is validated, the next work is Knowledge Governance:

1. typed provenance
2. supersession
3. freshness / staleness
4. conflict detection
5. confidence and scope enforcement
6. project baselines
7. retrieval precedence

That governance layer makes approved knowledge increasingly trustworthy before the Mission Engine begins relying on it for broader autonomous work.
