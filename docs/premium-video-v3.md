# Premium video rendered review loop

The video path now uses the existing Adobe worker and Premiere UXP bridge. It exports an explicit project sequence with an existing Adobe `.epr` preset, verifies a new MP4 on the worker, probes its streams, samples decoded frames, and stores a versioned review artifact. The API advances the persisted run one step at a time; render and analysis jobs remain on the Adobe worker.

## Requirements

- Start the configured Adobe worker and connect the Premiere bridge. The bridge must advertise `sequence.render`, `sequence.effects.inspect`, and `sequence.effect.remove` for the repair path.
- Configure `FREEOS_ADOBE_ALLOWED_PROJECT_ROOTS` and `FREEOS_ADOBE_ALLOWED_MEDIA_ROOTS` on the worker. Project files must be under the project roots; output files, sources, and `.epr` presets must be under media roots. The output directory must exist.
- Configure ffmpeg/ffprobe and the existing Python media analyzer dependencies on the worker. `FREEOS_VIDEO_PYTHON` or `FREEOS_AUDIO_PYTHON` may point to the Python environment. The audio analyzer is required for any render that contains audio, including when audio was not marked as expected.
- Supply a review preset suited to fast analysis, such as 720p H.264. FREEOS requires an explicit `.epr` path and does not infer delivery quality from a review preset.

## Run sequence

1. Create a video run with `POST /premium/plan`, then produce or submit an Editing Core plan. The resulting `edit-plan` artifact ID is the review input.
2. Request `POST /premium/video/review-request` with `runId` and `spec: { projectPath, sequenceId, presetPath, outputPath, planArtifactId, audioExpected, sourcePath? }`. The output filename must be `review-v1.mp4`, then `review-v2.mp4`, and so on. A source path must match a registered video source artifact.
3. Approve the returned Tool Request through the existing `/tools/requests/:id/approve` flow with the default `executeNow: false`. The premium iteration endpoint claims the approved request. Call `POST /premium/video/iterate` with `runId` until it returns a gate result or a new required action. `GET /premium/runs/:id` shows the persisted stage, job IDs, artifact versions, findings, comparisons, telemetry, and approval IDs.
4. For a supported repair, call `POST /premium/video/repair-request` with `runId`, the exact rendered finding ID, and `target: { trackIndex, clipStart, clipEnd, componentMatchName }`. FREEOS inspects the specified clip and checks that the component exists once. Approve its Tool Request, then call `POST /premium/video/repair-iterate` until the effect removal completes. Request the next review version and repeat the review steps.
5. When `GET /premium/video/runs/:id/gate` returns `PASS`, request `POST /premium/video/final-request` with `runId`, a separate `outputPath`, and a delivery `presetPath`. Approve and advance with `POST /premium/video/final-iterate`. The delivery artifact is distinct from every review render. A pending memory proposal is created from the run learning candidate; durable learning still requires governance approval.

The Premiere project and sequence are checked again inside the bridge. Effect removal backs up the project before mutation and saves it after the approved action. All media paths are checked against the worker allowlists. The synthetic test fixture does not open or change a real Adobe project.

## Current limits

- The Premiere export and effect removal APIs are implemented but have not been exercised against a live Premiere installation. The bridge requires Premiere 25.6 or newer and a compatible `.epr` preset.
- The first concrete repair is removal of one inspected effect component. Color, exposure, saturation, sharpening, and effect strength adjustments remain unverified and their old placeholder executor now fails explicitly.
- Editorial review uses the existing Editing Core plan critic and maps rendered findings to saved decisions. The rendered review does not independently infer all edit cuts from frames.
- Source comparison is used only when durations are comparable. A single camera source from a multicamera edit cannot stand in for the whole timeline.
- The API requires repeated step calls to advance jobs. Worker history provides job recovery on reconnect, but there is no background scheduler that automatically advances every run.
