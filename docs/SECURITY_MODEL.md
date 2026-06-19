# FREEOS Security Model

FREEOS uses deny-first permissions. Model output, voice input, search results, pages, automation events, and stored context are data—not authorization.

## Tool risk levels

- `read_only`: enabled status and inspection tools can run directly and are logged.
- `low_risk_write`: creates content only in approved FREEOS stores or folders; always requires a pending request to be approved before execution.
- `medium_risk`: preview-first actions such as running a fixed, pre-approved local script; requires approval and a second execution-time allowlist check.
- `high_risk`: deletion, sending, purchasing, trading, deployment, credential access, and system-level changes; blocked and unimplemented in Phase 5.

Approval does not bypass policy. An approved request can still be blocked if its tool is disabled, its path escapes allowed folders, its file type is not text/Markdown, or its script is not whitelisted.

## Path and command safety

- File creation is limited to `data/`, `docs/`, `generated/`, and `exports/` below the FREEOS root.
- Resolved path containment prevents `..` traversal and outside-root absolute paths.
- There is no automatic deletion.
- Existing files require `overwrite: true` in the args that the user approves.
- Scripts use direct process argument arrays, not a hidden shell command.
- Only explicitly listed scripts in `tools/scripts` can run.
- Tool requests, runs, automation events, and policy decisions are recorded locally.

## Voice, network, and external effects

Voice never approves or executes a tool. The microphone is push-to-talk, transcripts do not become approved memory automatically, and there is no always-listening action loop. Email, messages, purchases, trades, deployments, and credential reads have no executor. Ollama, SearXNG, STT, and TTS remain local/optional; no paid API key or cloud AI provider is required.

Logs and `system_events` should not contain secrets. Phase 5 has no background automation scheduler.

## Command Center rules

- Chat calls local Ollama only and never executes tools.
- Chat may create a pending memory proposal or tool request; neither is automatically approved or run.
- Unified approval views reuse existing approval transitions. Tool approval and execution are separate actions.
- High-risk requests are refused and high-risk tools remain disabled.
- Backups never delete or overwrite and exclude `.env`, dependencies, model files, large service trees, and generated voice audio by default.
- Unified activity is a local audit view, not an execution channel.
- The Command Center does not enable cloud providers, always-listening voice, or a background scheduler.
