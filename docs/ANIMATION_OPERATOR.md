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

`packages/animation-core` stays model-agnostic at the orchestration boundary. It identifies the intended workflow family as `wan-vace-video-to-video`, but it does not hard-code a ComfyUI graph because installed nodes, model filenames, and workflow node IDs differ between machines. Instead, FREEOS binds a reviewed API-format workflow through an explicit binding contract.

## What exists now

- Reuses `@freeos/media-intelligence` video evidence instead of duplicating video analysis.
- Creates scene-aware shots, splitting long uninterrupted takes into bounded render chunks.
- Adds overlap to each control window for temporal continuity.
- Carries shot scale, framing role, motion role, face/person presence, motion level, and source quality warnings into the plan.
- Selects depth, pose, segmentation, face-reference, and camera-motion controls per shot.
- Produces landscape or portrait generation dimensions aligned to multiples of 16.
- Defaults `local-final` to a 480-short-edge generation target with a capped long edge, then records a 1080-short-edge delivery target.
- Carries character/style bible references into every render job.
- Produces deterministic render-job output prefixes under `generated/animation/<project>/shots/`.
- Provides loopback-only ComfyUI health, queue, and history helpers.
- Provides a workflow binding contract so a reviewed DFB AI Studio graph can receive control video, references, prompts, dimensions, frame count, seed, FPS, and output prefix without hard-coded node IDs in source code.
- Provides an executable render bridge that extracts/stages the control clip and references, binds the workflow, writes an audit manifest, and queues the shot locally.

## Commands

Check the configured local ComfyUI endpoint:

```powershell
npm run animation:doctor
```

Default endpoint:

```text
http://127.0.0.1:8188
```

Override it in `.env` with `FREEOS_COMFYUI_URL`. The animation adapter only accepts HTTP loopback hosts.

Analyze a source video and emit an animation plan plus per-shot render jobs:

```powershell
npm run animation:plan -- "E:\Media\blakeo.mp4"
```

For a reusable JSON plan file in PowerShell, use npm's silent mode so only the JSON is redirected:

```powershell
npm --silent run animation:plan -- "E:\Media\blakeo.mp4" --mode=local-final --project=blakeo-cartoon > .\generated\blakeo-plan.json
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

## Bind the real DFB AI Studio VACE workflow

1. Open the known-good Wan/VACE video-to-video graph in ComfyUI.
2. Export/save it in API format.
3. Copy `docs/examples/wan-vace-binding.example.json` to a project-specific binding file.
4. Replace the placeholder node IDs and input names with the actual IDs/input names from that exported API workflow.
5. Keep model filenames, VACE strengths, sampler settings, LoRAs, and other static workflow choices inside the reviewed ComfyUI template. FREEOS only patches the values that change per shot.

The supported binding sources are:

```text
controlVideo
characterReference
styleReference
positivePrompt
negativePrompt
width
height
fps
controlFrameCount
shotFrameCount
trimStartFrames
trimEndFrames
seed
outputPrefix
```

If a workflow does not use one of these values, omit that assignment. Mark a mapping with `"required": false` when the workflow can run without that source, such as an optional style-reference image.

## Prepare and queue one shot

Point FREEOS at the local ComfyUI input directory. Example:

```powershell
$env:FREEOS_COMFYUI_INPUT_DIR = "E:\DFB_AI_Studio\ComfyUI\input"
$env:FREEOS_COMFYUI_URL = "http://127.0.0.1:8188"
```

First run a dry run. FREEOS still extracts and stages the exact overlapping control clip and references, and it writes the bound workflow/audit files, but it does not submit a prompt:

```powershell
npm run animation:render -- `
  --plan=".\generated\blakeo-plan.json" `
  --workflow="E:\DFB_AI_Studio\workflows\blakeo_vace_api.json" `
  --binding="E:\DFB_AI_Studio\workflows\blakeo_vace_binding.json" `
  --shot=shot-001 `
  --dry-run
```

Queue the shot after reviewing the generated workflow:

```powershell
npm run animation:render -- `
  --plan=".\generated\blakeo-plan.json" `
  --workflow="E:\DFB_AI_Studio\workflows\blakeo_vace_api.json" `
  --binding="E:\DFB_AI_Studio\workflows\blakeo_vace_binding.json" `
  --shot=shot-001
```

To keep polling until ComfyUI exposes an output file:

```powershell
npm run animation:render -- `
  --plan=".\generated\blakeo-plan.json" `
  --workflow="E:\DFB_AI_Studio\workflows\blakeo_vace_api.json" `
  --binding="E:\DFB_AI_Studio\workflows\blakeo_vace_binding.json" `
  --shot=shot-001 `
  --wait
```

The worker stages media beneath:

```text
<ComfyUI input>/freeos-animation/<project>/<shot>/
```

and writes audit data beneath:

```text
generated/animation/<project>/manifests/
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

If no approved character design is attached to the plan yet, the render bridge extracts a source-video reference frame as a temporary fallback. That is enough to exercise the pipeline, but the premium path is an approved cartoon character design plus multiple identity/wardrobe references.

## Remaining production layers

The render bridge is now in place. The next production layers are:

1. Lock and validate one known-good Wan/VACE API workflow from the user's installed DFB AI Studio / ComfyUI environment.
2. Add cached pose/depth/segmentation preprocessing per control window and bind those control assets when the reviewed graph expects them.
3. Route render submission through FREEOS's existing request -> approval -> run -> audit path instead of using the CLI directly.
4. Add identity, pose, motion, flicker, wardrobe/accessory, and background-continuity QA.
5. Selectively rerender only failing frame ranges/shots.
6. Trim overlap, assemble approved shots, upscale/finish, and remux untouched original audio.

## Safety boundary

Planning is read-only with respect to the source video. The render bridge only writes generated/staging files and talks to a loopback ComfyUI endpoint. When animation rendering is exposed through Tool Runner, render submission should use FREEOS's existing approval/audit flow so a user-visible action remains approval-gated.
