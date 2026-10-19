# FREEOS Animation Operator

The Animation Operator is the local-first bridge between FREEOS media intelligence and DFB AI Studio / ComfyUI video generation. Its job is to turn a source performance video into deterministic shot plans and render jobs while preserving the source performance, timing, camera language, and original audio.

## Goal

The target is controlled video-to-animation, not a frame-by-frame cartoon filter:

```text
source performance video
  -> media-intelligence analysis
  -> animation shot plan
  -> control extraction / reference preparation
  -> local ComfyUI Wan/VACE workflow
  -> shot renders with overlap
  -> continuity QA / selective rerender
  -> upscale / finishing
  -> original-audio remux
```

`packages/animation-core` is intentionally model-agnostic at the orchestration boundary. It identifies the intended workflow family as `wan-vace-video-to-video`, but it does not hard-code a ComfyUI graph because installed nodes, model filenames, and workflow node IDs differ between machines. A reviewed API-format workflow will be bound in the next render-worker layer.

## What exists in the foundation

- Reuses `@freeos/media-intelligence` video evidence instead of duplicating video analysis.
- Creates scene-aware shots, splitting long uninterrupted takes into bounded render chunks.
- Adds overlap to each control window for temporal continuity.
- Carries shot scale, framing role, motion role, face/person presence, motion level, and source quality warnings into the plan.
- Selects depth, pose, segmentation, face-reference, and camera-motion controls per shot.
- Produces landscape or portrait generation dimensions aligned to multiples of 16.
- Defaults `local-final` to a 480-short-edge generation target with a capped long edge, then records a 1080-short-edge delivery target.
- Produces deterministic render-job output prefixes under `generated/animation/<project>/shots/`.
- Provides a local-only ComfyUI health check and workflow queue helper. Remote ComfyUI hosts are rejected by policy.

## Commands

Check the configured local ComfyUI endpoint:

```powershell
npm run animation:doctor
```

Default endpoint:

```text
http://127.0.0.1:8188
```

Override it in `.env` with `FREEOS_COMFYUI_URL`, but the current foundation only accepts HTTP loopback hosts.

Analyze a source video and emit an animation plan plus per-shot render jobs:

```powershell
npm run animation:plan -- "E:\Media\blakeo.mp4"
```

Preview planning:

```powershell
npm run animation:plan -- "E:\Media\blakeo.mp4" --mode=preview
```

Optional analysis controls:

```powershell
npm run animation:plan -- "E:\Media\blakeo.mp4" --mode=local-final --sample-fps=2 --project=blakeo-cartoon
```

Run the animation-core unit tests:

```powershell
npm run test:animation
```

## Quality modes

### `preview`

Fast style/motion proof. Uses a 256-pixel short edge and a 448-pixel long-edge cap.

### `local-final`

Primary RTX 3070 Laptop / 8 GB VRAM planning target. Uses a 480-pixel short edge and an 848-pixel long-edge cap, preserving portrait or landscape orientation. Final delivery dimensions use a 1080-pixel short edge.

### `ultra`

Planning profile for a larger renderer or future upgraded hardware. Uses a 720-pixel short edge with a 1280-pixel long-edge cap. It is a planning option, not a claim that the current 8 GB GPU can render every Ultra workflow locally.

## Character and style lock

`AnimationPlan` supports optional character and style bible references. The intended project structure is:

```text
generated/animation/<project>/
  character/
    approved-design.*
    references/
  style/
    references/
  controls/
  shots/
  qa/
  final/
```

The character bible should hold approved face, full-body, wardrobe, jewelry/accessory, and hero-design references. The style bible should hold the approved visual prompt, negative prompt, palette/look references, and any future LoRA/adapter identity.

## Next implementation layer

The foundation deliberately stops before blindly queueing a guessed VACE graph. The next layer should:

1. Export or install one known-good ComfyUI API-format Wan/VACE video-to-video workflow in DFB AI Studio.
2. Define reviewed bindings for source/control video, reference image, positive/negative prompt, seed, dimensions, frame count, and output prefix.
3. Add FFmpeg shot/control extraction so each render job gets its exact overlapping control clip.
4. Add pose/depth/segmentation preprocessors and cache their outputs per shot.
5. Add a render worker that binds a job to the reviewed workflow and calls `queueComfyWorkflow()` only after FREEOS approval.
6. Add history/status polling, output discovery, cancellation, and audit records.
7. Add identity/motion/flicker QA and selective rerender decisions.
8. Assemble approved shots, upscale/finish, and remux untouched original audio.

## Safety boundary

Planning is read-only with respect to the source video. Render submission is an action and should enter FREEOS's existing request -> approval -> run -> audit path when it is exposed through Tool Runner. The ComfyUI adapter currently enforces loopback-only networking so source media is not silently submitted to a LAN or internet host.
