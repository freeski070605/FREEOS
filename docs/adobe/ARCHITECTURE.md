# FREEOS Adobe architecture

The laptop API stays on `127.0.0.1`. Its Adobe service makes an outbound authenticated `wss://` connection to the AIO worker. The AIO worker binds to the configured LAN interface only when a TLS certificate and key are present. Each UXP plugin connects to a second WebSocket listener on the AIO loopback interface. A distinct bridge token is supplied in the plugin panel and is held in memory for that session.

The worker advertises machine identity, installed applications, process state, and actions supported by the connected bridges. The laptop submits a job only when the worker advertises that exact action. Jobs have IDs, state transitions, result method, timestamps, and an append-only JSONL audit at `data/adobe-worker/history.jsonl`. Heartbeats run every five seconds. The laptop reconnects after connection loss. A queued job can be cancelled; in-flight Adobe host calls cannot yet be interrupted safely.

The worker delegates application launch and desktop observation to the existing `computer-core` policy. Project and media file paths must resolve under configured roots. The worker refuses LAN binding without TLS and refuses start without 32-character or longer tokens.

`editing-core` produces structured performance edit decisions, per-shot color matching adjustments, justified punch-in plans, and review flags. These plans are not applied automatically. The current bridges cover project inspection and version-safe working-copy creation, which is the prerequisite for destructive timeline editing.

The API is reachable at `/adobe/status`, `/adobe/jobs`, and `/adobe/jobs/:id`. The dashboard Adobe Workstation tab shows connection, capabilities, and job history. The API itself remains loopback-bound like the rest of FREEOS.

Current worker actions: `premiere.app.state`, `premiere.app.launch`, `premiere.project.backup`, `premiere.project.inspect`, `premiere.project.items`, `premiere.project.open`, `premiere.project.save`, `premiere.project.saveas`, `premiere.sequence.inspect`, `premiere.sequence.markers`, `premiere.sequence.settings`, `premiere.sequence.clone`; analogous app state and launch for After Effects and Media Encoder; After Effects project/composition operations advertised by its bridge; `media.media.probe`, `media.media.review`, `media.ui.status`, `media.ui.windows`, `media.ui.capture`. Render review uses FFmpeg black and silence detection. Actual action availability is shown by capability discovery.
