# FREEOS v1 Smoke-Test Checklist

Record the date, tester, commit, and any accepted optional-service warnings.

## Automated baseline

- [ ] `npm run build` passes.
- [ ] `npm run env:check` has no required failures.
- [ ] `npm run db:integrity` passes.
- [ ] `npm run backup:verify` verifies the latest backup.
- [ ] With the API running, `npm run smoke:test` passes.
- [ ] With the API running, `npm run release:check` passes.

## Manual Command Center checks

- [ ] Dashboard opens and healthy panels load independently.
- [ ] Command Center status loads and shows version 1.0.0, Command Center v1, Phase 6, stable release.
- [ ] Chat responds through local Ollama, or shows a clear offline/timeout message.
- [ ] A memory proposal can be created, approved, and rejected.
- [ ] A project note can be created and appears in the selected project.
- [ ] Research status loads when SearXNG is offline.
- [ ] Web search works when SearXNG is online.
- [ ] Voice status loads when STT/TTS are not configured.
- [ ] A push-to-talk recording saves after browser microphone approval.
- [ ] Tools status and the registry load.
- [ ] A read-only tool runs directly and records a tool run.
- [ ] A write tool creates a request, requires approval, and only runs after a separate click.
- [ ] A high-risk tool remains disabled/blocked.
- [ ] A backup creates successfully and includes a manifest.
- [ ] `npm run backup:verify` verifies the newly created backup.
- [ ] The activity timeline loads and empty queues show useful messages.

## Acceptable warnings

Ollama, SearXNG, FFmpeg, whisper.cpp, Piper, or CUDA may be offline or unconfigured when their feature is not under test. These warnings are acceptable if the API, database, dashboard, safety locks, and selected release checks remain healthy.
