# FREEOS Governance-Aware Retrieval

Status: Foundation implemented

## Purpose

Knowledge Governance now affects default RAG retrieval rather than existing only as metadata beside the retrieval system.

Core rule:

> Retrieval relevance finds candidates. Governance decides which candidates are allowed to control context and how strongly they should rank.

## Behavior

The exported `RagService` is now a governance-aware wrapper around the original RAG service.

For normal searches it:

1. retrieves a larger relevance candidate pool;
2. merges project-scoped and global candidates when a project is active;
3. reads Knowledge Governance metadata for each document;
4. excludes non-active governed documents from default retrieval;
5. filters project-scoped retrieval so unrelated low-authority global/project knowledge does not leak into the project context;
6. ranks the remaining candidates using relevance, authority, project baseline role, direct project scope, and confidence;
7. returns the requested top-K results.

## Default status policy

Default RAG retrieval admits only `active` governed documents.

The following remain inspectable through Knowledge Governance but are not admitted silently into normal RAG context:

- `stale`
- `disputed`
- `superseded`
- `archived`

This is intentionally conservative. A future explicit historical/conflict/freshness workflow may request these states with visible warnings, but they do not silently control ordinary answers.

## Project scope

For a project-scoped query, a document can enter the governed candidate set when one of these is true:

- the indexed document is directly scoped to that project;
- it is linked to that project through a `canonical` or `supporting` knowledge baseline;
- it is global high-authority canonical/hard-rule knowledge.

This lets globally stored institutional files remain single-source while still serving specific project contexts.

## Ranking

The current governed score combines:

- retrieval relevance rank: primary signal;
- governance authority rank;
- project baseline role (`canonical` receives a stronger boost than `supporting`);
- direct project scope;
- confidence.

This avoids two bad extremes:

- pure vector/keyword relevance deciding truth;
- unrelated high-authority documents outranking strongly relevant project material solely because they are authoritative.

## Context annotation

`buildContext()` now prepends a Knowledge Governance header when governed document context is present. The header tells the model:

- only active governed documents were admitted;
- authority should resolve disagreement;
- canonical project baselines outrank supporting context at equal authority;
- retrieval score alone is not truth.

Each retrieved document is identified with its authority, authority rank, status, confidence, and baseline role when applicable.

## Backward compatibility

If Knowledge Governance tables have not been created/bootstraped yet, `RagService` preserves legacy retrieval behavior instead of breaking RAG.

The original implementation remains in `ragService.ts`; the package root now exports the governance-aware subclass from `governedRagService.ts`.

## Validation

Run:

```powershell
cd E:\FREEOS

powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\tools\scripts\test-governed-retrieval.ps1
```

The validation checks:

- governed metadata is present on normal `/rag/search` results;
- non-active knowledge is not admitted;
- low-authority out-of-scope knowledge is not admitted to a project query;
- ReemTeam and FREEOS canonical baselines can be retrieved;
- `/rag/context` includes the governance header.

## Next step

Governance-aware RAG is one part of the broader truth system. The next layers are:

1. governance-aware approved-memory/project-note context;
2. current intelligence and freshness-aware external research;
3. Continuous Learning Engine;
4. Mission Engine v1.
