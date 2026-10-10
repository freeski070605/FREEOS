# FREEOS Production Operators

Production Operators turn Remote Ops jobs into governed work inside installed creative/development applications instead of treating every objective as a chat question.

## Operator catalog

| Operator | Current capability |
| --- | --- |
| Blender | launch, UI control, governed native scene-plan execution, verified `.blend` + PNG output |
| Premiere Pro | launch + approved UI control foundation |
| After Effects | launch + approved UI control foundation |
| Photoshop | launch + approved UI control foundation |
| Lightroom | launch + approved UI control foundation |
| Unity | launch + approved UI control foundation |
| Unreal Engine | launch + approved UI control foundation |
| ComfyUI Desktop | launch + approved UI control foundation |
| OBS Studio | launch + approved UI control foundation |
| VS Code | launch + approved UI control foundation; code changes remain governed by Coding Workspace |

Blender is the first native production adapter. The other operators are intentionally registered now so their dedicated native adapters can be added without widening desktop execution to arbitrary programs or shells.

## Setup

From the FREEOS root on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\scripts\setup-production-operators.ps1
```

The helper enables the existing Computer Operator and screen-capture switches, discovers supported installed applications in common locations, and records only exact recognized executable paths in `.env`. Restart FREEOS after setup.

Operator paths can also be set manually:

```text
FREEOS_OPERATOR_BLENDER_EXE=C:\Program Files\Blender Foundation\Blender 4.5\blender.exe
FREEOS_OPERATOR_PREMIERE_EXE=C:\Program Files\Adobe\Adobe Premiere Pro 2026\Adobe Premiere Pro.exe
...
```

Each operator only accepts its expected executable name. Command shells, script hosts, file managers, browsers through Computer Operator, credential access, and the existing high-risk actions remain outside operator scope.

## Remote Ops behavior

Choose **Run a production operator** when creating a Remote Ops task.

For Blender jobs FREEOS now:

1. checks that Blender is configured,
2. converts the objective into a structured JSON scene plan using the local model,
3. falls back to a deterministic stylized character blockout if the local plan is invalid,
4. creates an owner approval request,
5. executes the approved plan through the fixed FREEOS Blender driver,
6. writes output only under `generated/operators/blender/jobs/<job-key>/`,
7. verifies the generated manifest and `.blend` before marking the Remote Ops task complete.

The Blender adapter does **not** execute arbitrary model-generated Python. The model supplies scene data; a fixed driver performs the supported Blender operations.

## Blender output

A Remote Ops Blender job writes:

```text
generated/operators/blender/
  plans/
    remote-task-<id>.json
  jobs/
    remote-task-<id>/
      character.blend
      preview.png
      manifest.json
```

The task is not considered complete merely because Blender exits successfully. Remote Ops checks the manifest and expected `.blend` output.

## Safety boundary retained

Production access is broad inside explicitly configured creative applications, but FREEOS still does not gain unrestricted credential access, arbitrary command-shell execution, destructive system/file operations, live money movement, purchases, external sending, or production deployment authority from an operator task.
