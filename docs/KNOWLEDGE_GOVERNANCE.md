# FREEOS Knowledge Governance

Status: Foundation implemented

## Purpose

FREEOS now has more than one form of knowledge: Constitution and hard rules, approved institutional documents, approved memories, project notes, RAG documents, experience-derived lessons, research, and model reasoning. Knowledge Governance exists so FREEOS can distinguish what is controlling, what is merely useful, what is stale, what conflicts, and what has been superseded.

Core rule:

> Retrieval relevance does not equal authority.

A lower-authority item may be highly relevant to a query and still lose to a higher-authority controlling source.

## Authority order

Highest to lowest:

1. `constitution-hard-rule`
2. `current-owner-instruction`
3. `live-observation`
4. `approved-canonical`
5. `approved-memory`
6. `primary-external`
7. `reliable-secondary`
8. `unapproved-draft`
9. `model-background`
10. `inference`

## Knowledge status

- `active` — usable controlling/supporting knowledge
- `stale` — may still be informative but needs freshness caution or re-verification
- `disputed` — known conflict exists; do not silently choose it as truth
- `superseded` — historical knowledge replaced by newer controlling knowledge
- `archived` — retained for history, not active reasoning

## Confidence

- `confirmed`
- `high`
- `moderate`
- `low`
- `unverified`
- `disputed`

Confidence measures evidence strength. It does not override authority by itself.

## Provenance

Every governed record tracks where it came from through source type/reference, project scope, provenance text, effective/verification dates, and an optional freshness window.

FREEOS should be able to answer not only "what do I know?" but also "why do I believe this and where did it come from?"

## Supersession

When newer approved knowledge replaces older knowledge, the old item is retained as `superseded` rather than erased. The new item references the record it supersedes.

## Conflicts

Known disagreements can be registered as explicit conflicts. Both records become `disputed` until the conflict is resolved. Resolution records the winner and a note; the losing record becomes `superseded` and the winner returns to `active`.

FREEOS must surface meaningful unresolved conflicts rather than averaging incompatible claims together.

## Freshness

Knowledge may optionally carry a `freshnessDays` value. If the most recent verification/effective time exceeds that window, the record becomes `stale` during freshness refresh.

Canonical strategy and owner principles normally have no automatic expiration. Live facts, external research, prices, schedules, platform behavior, and other changing information should generally use freshness controls.

## Project baselines

Project baselines solve a problem in the old knowledge inventory: global institutional documents could contain strong project knowledge while project-specific note/RAG counts still showed `EMPTY`.

A baseline is a link from a project to governed knowledge without copying the document.

Roles:

- `canonical` — primary institutional knowledge for that project
- `supporting` — cross-project or global context that should inform the project

The governance bootstrap links the approved education corpus to relevant DFB projects while leaving the original files global and canonical.

## Expanded DFB project registry

The default project registry now includes FREEOS, DFB Solutions, DFB AI Studio, DFB Social OS, DFB Sounds, ReemTeam, Still Raising Drew, Get Ya 5, Chester World, DFB Transportation, Client Builds, SignalFlow, Divine Decor, Business Ideas, and Personal.

This is an operational registry, not a claim that every project has equal priority or maturity.

## Bootstrap behavior

`POST /knowledge/bootstrap` registers current knowledge without duplicating content:

- approved memories become governed records
- project notes become lower-authority draft records
- indexed RAG documents become governed records
- Constitution-like paths receive highest authority
- approved institutional/core knowledge receives approved-canonical authority
- ordinary indexed documents default to unapproved-draft until explicitly promoted
- project baseline links are created for the approved DFB education documents

The bootstrap is idempotent because source type + source reference is unique.

## Learning integration

When a Learning Proposal is approved through `/learning/proposals/:id/approve`, the resulting approved memory is also registered in Knowledge Governance automatically.

```text
candidate learning
    ↓
Learning Proposal
    ↓
owner approval
    ↓
approved memory
    ↓
knowledge governance record
```

## API

Base path: `/knowledge`

- `GET /knowledge/status`
- `POST /knowledge/bootstrap`
- `GET /knowledge/records`
- `GET /knowledge/records/:id`
- `POST /knowledge/records`
- `POST /knowledge/records/:id/supersede`
- `GET /knowledge/baselines`
- `GET /knowledge/conflicts`
- `POST /knowledge/conflicts`
- `POST /knowledge/conflicts/:id/resolve`
- `POST /knowledge/refresh-freshness`
- `GET /knowledge/policy`

## What Knowledge Governance v1 does not do yet

It does not yet rewrite every RAG ranking score based on authority. The initial foundation establishes typed governance, project baselines, provenance, supersession, conflict state, freshness, and deterministic governed ordering.

The next integration step is to feed governed authority/conflict/freshness metadata directly into FREEOS retrieval and decision context so a relevant but superseded or disputed chunk cannot silently control an answer.

The broader roadmap remains:

1. approved institutional education
2. Learning Proposals
3. Experience Learning
4. Knowledge Governance foundation
5. governance-aware retrieval/current intelligence
6. Continuous Learning Engine
7. Mission Engine v1
