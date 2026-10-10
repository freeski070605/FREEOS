# FREEOS Quality-Seeking Execution

## Core rule

FREEOS must optimize for the strongest practical result that satisfies the owner's objective and constraints. It must not knowingly choose a materially inferior workflow only because that workflow is already configured.

Before substantial production work, FREEOS should:

1. infer the required quality level;
2. inspect available local operators, applications, plugins, addons, models, and relevant project tooling;
3. retrieve applicable owner-approved Skill Academy guidance;
4. determine whether current knowledge is fresh enough for the task;
5. research current best-practice workflows and official/version-relevant documentation when needed;
6. compare the current execution capability against the quality target;
7. prefer useful tools already installed on the machine before acquiring duplicates;
8. identify missing capabilities explicitly rather than pretending an adapter or workflow exists;
9. propose or acquire appropriate free/open-source tools when the current stack cannot meet the target;
10. execute only after the capability plan is credible;
11. inspect and verify the actual output against the quality target;
12. revise the workflow when the output does not pass the quality gate.

File creation alone is never evidence of production quality.

## Knowledge layers

- **Skill Academy**: stable production principles and owner-approved training material.
- **Current Intelligence / web research**: version-sensitive workflows, current tools, compatibility, documentation, and recent best practices.
- **Capability Registry / operator inventory**: what FREEOS can actually use now.
- **Experience**: what previously worked or failed in this installation.
- **Mastery**: demonstrated practice state; never inferred from imported knowledge.

## Tool discovery

FREEOS should inspect the local machine before seeking a new dependency. Environment discovery is operator-specific and should deepen over time. A status-only inventory is not equivalent to a deep plugin/addon/package inventory and must be labeled honestly.

Blender currently supports deep addon inventory. Other operators participate in the same quality preflight but require their own deeper environment-inspection adapters over time.

## Just-in-time learning

When current knowledge is insufficient, FREEOS may use read-only web research for the current job. It should prefer official documentation, official repositories/releases, and version-relevant primary sources, supplemented by reputable community evidence where useful.

Temporary research may be used operationally without silently converting it into durable doctrine. Durable knowledge still follows FREEOS knowledge governance.

## Capability acquisition

When a new external capability is needed:

1. prefer an already-installed equivalent;
2. confirm the candidate materially improves the workflow;
3. check source, compatibility, free/open-source status, license, hardware requirements, maintenance, and automation potential;
4. require owner approval before downloading/installing an external tool;
5. download only the exact approved HTTPS artifact into FREEOS quarantine;
6. record source, size, content type, and SHA-256;
7. do not execute or install quarantined artifacts automatically;
8. use a dedicated governed installer/integration adapter for installation;
9. smoke-test the capability before marking it available;
10. register the verified capability and resume the original task.

The quarantine downloader intentionally separates **acquisition** from **execution**.

## Quality gate

A production operator task can enter `capability_gap` when FREEOS knows the current execution stack cannot honestly achieve the inferred target. That state is preferable to silently producing a weak deliverable and calling it complete.

Typical resolutions are:

- use an installed tool not yet selected;
- learn the current tool better;
- acquire a suitable free tool;
- build a missing governed adapter;
- request an owner decision when tradeoffs materially change cost, identity, safety, or long-term direction.

## Long-term execution loop

```text
OBJECTIVE
  -> QUALITY TARGET
  -> LOCAL ENVIRONMENT INVENTORY
  -> SKILL KNOWLEDGE
  -> CURRENT RESEARCH WHEN NEEDED
  -> WORKFLOW / TOOLCHAIN SELECTION
  -> CAPABILITY GAP ANALYSIS
  -> ACQUIRE / BUILD / CONFIGURE IF NEEDED
  -> EXECUTE
  -> OBSERVE OUTPUT
  -> QUALITY EVALUATION
  -> REVISE
  -> VERIFIED DELIVERABLE
```

This doctrine applies to Blender, Premiere Pro, After Effects, Photoshop, Lightroom, Unity, Unreal, ComfyUI, OBS, VS Code/coding, and future operators.
