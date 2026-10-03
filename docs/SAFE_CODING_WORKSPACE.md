# FREEOS 1.2 Safe Coding Workspace

The workflow is **Observe → Plan → Preview → Approve → Apply → Verify → Report**. Chat does not edit files or run coding commands. The dashboard can inspect registered workspaces and submit Tool Runner requests; a person must approve and run each write, rollback, or verification command.

## Configuration

`CODING_ENABLED=true` enables direct filesystem and Git inspection. `CODING_WORKSPACE_ROOTS=E:\FREEOS` registers the default workspace. Additional roots can be separated by semicolons. Limits: `CODING_MAX_FILE_SIZE_KB=1024`, `CODING_MAX_CHANGED_FILES=25`, `CODING_MAX_CHANGE_BYTES=1048576`, and `CODING_COMMAND_TIMEOUT_MS=120000`. Computer control and screen capture remain independently disabled.

## Boundaries

All paths are relative to a registered root. Traversal, UNC roots, symlinks, protected directories, `.env*`, private keys, credentials, model files, generated binaries, and binary files are blocked. Inspection is bounded. Git calls use fixed arguments without a shell. Coding command execution accepts only listed npm scripts that exist in the workspace package.json, or fixed read-only Git commands. Neither command text nor a patch script is evaluated by a shell.

## Changes and sessions

Changes use complete text content with `create` or `update`. Updates require the current SHA-256. Preview validates every file and returns a diff plus a random preview ID valid for 30 minutes in the API process. Apply accepts only that ID, rechecks the whole set, and writes only after Tool Runner approval. A server restart expires previews safely.

Before writing, FREEOS stores only touched file backups under `exports/coding-sessions/<id>/before/`, with `manifest.json` and `after-metadata.json`. Files are staged first; failed writes restore files already moved. Rollback checks all current post-apply hashes before restoring or removing session-created files. A later manual edit blocks rollback. Session history is visible in Coding.

The approval queue is authoritative: `coding.change.apply`, `coding.command.run`, and `coding.session.rollback` are medium risk. The read-only preview and inspection tools run directly and are audited. Persistent audit rows redact read content, diffs, search matches, and proposed file content.

The implementation does not create autonomous coding agents, use computer input, index RAG, or enable trading.
