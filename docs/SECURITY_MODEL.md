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
- There is no arbitrary automatic deletion. Computer screenshot housekeeping is the sole narrow exception described below.
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

## RAG (Retrieval Augmented Generation) rules

- **Scanning scope**: RAG only indexes files in allowed roots (`data/documents`, `data/projects`, `docs`). The entire filesystem is never scanned.
- **Exclusions**: RAG never indexes secrets (`.env` files), model files (`.gguf`, `.bin`), databases (`.sqlite`, `.db`), audio/video files, or excluded directories (`node_modules`, `.git`, `exports/backups`, etc.).
- **Source file safety**: Deleting document index records does not delete the source file. Source files are never destructively modified during indexing.
- **Memory approval**: Document content is used only for context in chat, not automatically saved as memory. Documents do not bypass memory approval requirements.
- **Embeddings**: Optional local embeddings through Ollama require explicit opt-in and configuration. Keyword search works without any embedding service.
- **No cloud dependency**: RAG requires only local SQLite and Ollama (if embeddings are enabled). No paid API keys or cloud providers are required.

## Computer Operator Foundation (1.1)

`COMPUTER_CONTROL_ENABLED=false` and `COMPUTER_SCREEN_CAPTURE_ENABLED=false` are independent default-off kill switches. Only the exact value `true` opts in. Status, visible-window, active-window, and safe process inspection remain available while locked. `isComputerControlAllowed()` is the centralized emergency-stop policy seam; every control checks it at execution time. Changing the environment file requires restarting the API; this is not yet a global in-flight emergency stop.

Brain -> future Agent/Planner -> Tool approval layer -> Computer Operator -> Windows. The operator supplies capabilities and never chooses its own mission. Model output, chat, voice, automation events, and observed screen/window content cannot grant permission.

- Observation tools run through the existing executor and log runs. Capture additionally requires the separate capture switch. Screenshots can contain private desktop content: opt in only when the desktop is appropriate to capture.
- Focus, mouse movement/clicks, typing, allowed keys/hotkeys, and app launch are medium-risk actions requiring request -> inspect -> approve -> run -> log. Registry tampering cannot make a computer control run directly. Every attempt that reaches execution has arguments, timestamps, approval linkage, and result/error. Approved requests are single-use, including concurrent calls and blocked attempts.
- Exact executable paths and argument arrays are displayed before approval. Launch is limited to the Windows System32 paths for `notepad.exe`, `calc.exe`, and `mspaint.exe`, with empty args only. Everything else is denied, including cmd, PowerShell/pwsh, wscript/cscript, mshta, rundll32, reg, schtasks, interpreter hosts, and .bat/.cmd/.ps1/.vbs/.js scripts. No arbitrary shell text reaches PowerShell.
- Input targets must be visible main windows in trusted Windows locations belonging to Notepad, Paint, or Calculator. Input checks the current foreground window; clicks also check the window under the current physical monitor coordinates. Negative coordinates on secondary monitors are valid; gaps between monitors and off-screen coordinates are refused. Coordinates and focus can change after approval, so targets are rechecked during execution. This is not a security sandbox for a compromised local desktop.
- Typing uses literal Unicode SendInput, never SendKeys expression interpolation or clipboard paste. Limit: 4000 printable characters; no control characters. Enter, Windows-key shortcuts, paste, arbitrary hotkeys, and shell targets are unavailable. Allowed navigation keys and combinations are enumerated in `computer-core/src/policy.ts`.
- Do not submit passwords, tokens, private keys, or other secrets. Credential-like text is rejected, but pattern matching cannot identify every secret. All typed text is volatile in API memory and is redacted in persistent requests and runs; restarting expires it. Computer request titles/descriptions are server-generated to prevent accidental payload duplication. Native errors are generic and never echo inputs. Observation returns only the requested names, IDs, titles, and geometry; window titles and screenshots may still contain personal information. Titles are returned to the requesting UI but omitted from persisted audit outputs.
- Captures use random FREEOS PNG names exclusively under `generated/computer/screenshots/`. A serialized capture queue retains 20. Cleanup rejects symlinks/junction redirects, considers only regular files with the exact generated naming pattern, skips hardlinks, and unlinks only old captures in that exact directory. It never traverses or recursively deletes user folders. Local administrators who can concurrently replace files/directories remain outside this application's trust boundary.
- Computer control automation rules are not accepted in this foundation. No new background work or autonomous loop is installed. Tests keep both switches false and use isolated temporary SQLite databases.

Existing destructive and external-effect capabilities remain blocked: arbitrary deletion/formatting, shutdown/reboot, registry changes, process killing, installation/uninstallation, credential retrieval, messages/email, publishing, purchases, money transfers, cryptocurrency, live trading, and production deployment. The general computer agent must never independently decide to move money or place a trade. Future live trading needs a separate explicitly governed subsystem, not GUI input that bypasses trading policy.

Future work should prefer direct APIs and Windows UI Automation over coordinates, with keyboard/mouse fallback, then separately reviewed vision and browser layers. No screen-vision AI is included now.

## Safe Coding Workspace (1.2)

Coding has a separate registered-root boundary and does not use computer control or screen capture. Reads, search, diffs, previews, and fixed Git inspection are read-only. Apply, command run, and rollback are medium-risk Tool Runner actions requiring a pending request, human approval, and a separate run. Chat cannot run them directly. Registry configuration alone cannot make them read-only; the executor still checks policy.

Change sets contain only full text create/update operations. Updates require SHA-256 matches; preview IDs expire after 30 minutes and on restart. Apply revalidates all paths and hashes. Snapshots include touched files only, and rollback blocks if later edits changed a post-apply hash. Protected paths include `.env*`, SSH keys, credentials, tokens, browser profiles, dependencies, Git internals, models, binaries, and generated directories. Symlinks are refused. Audit records redact source reads, diffs, search matches, and proposed content. See [Safe Coding Workspace](SAFE_CODING_WORKSPACE.md).

## Browser Operator Foundation (1.3)

Browser profile, site grants, and browser screenshot settings are independent from Computer Operator. `BROWSER_CONTROL_ENABLED=false` blocks navigation and actions at execution. No personal Chrome/Edge profile is attached. Browser-only session state stays under `data/browser/profile`. Only HTTP(S), normalized origins, and explicitly granted interaction are accepted. Redirects are checked. Inspected element references expire on navigation. Tool Runner approval is required for navigation, click, input, select, check/uncheck, and form submission. Sensitive input is held in memory and redacted from stored requests and runs. Form submission has a separate preview and approval. Payment fields and obvious purchases, trades, transfers, messages, posts, legal signing, applications, account deletion, and password changes remain blocked. Downloads are unavailable. See `BROWSER_OPERATOR.md`.

## Opt-in Scheduler (1.4)

The global scheduler switch defaults off. Creating or changing a schedule, including pause and resume, requires a Tool Runner request, human approval, and a separate run. Read-only targets may execute automatically after approved schedule creation. Low-risk writes and medium-risk targets create fresh pending requests for every due occurrence. High-risk targets remain blocked. The target tool's current enabled state and Tool Runner policy are checked at due time. The browser's isolated persistent profile does not grant interaction, messaging, publishing, purchasing, or financial submission authority. Computer and coding safety switches remain authoritative. Pausing prevents new starts but cannot interrupt an already running operation. See [Opt-in Scheduler](OPT_IN_SCHEDULER.md).
