# FREEOS Premium Pipeline Core v1

FREEOS owns the production run. Skills describe reusable competencies; capabilities describe technologies selected for those skills. A capability is never the run owner. The core lives in `apps/api-server/src/services/premium` and uses the existing API server's SQLite database and safety boundaries.

## Run and quality model

`PremiumPipelineRun` stores the task and intent, quality target, production profile and plan, stage and status, artifacts, evaluations, repair history, failures, and telemetry. Targets `draft`, `standard`, `professional`, `premium`, and `maximum` change repair depth and required stages through each domain adapter. Domains define their own quality dimensions and thresholds. The universal gate checks required dimensions, material and blocking findings, and executed artifact review when final QC is required. It retains evidence and supports an explicit, attributed user override.

Artifacts carry source IDs, operation, skill, capability, version, prior version, evaluation IDs, and repair ID. Plan review and executed artifact review have separate types. A plan review cannot satisfy the final artifact requirement. Evaluation aggregation retains measurement type and confidence, so differing evidence sources remain visible.

## Registries and direction

The domain registry owns adapters. Skill, capability, evaluator, benchmark, and Academy knowledge registries reject duplicate IDs. Skill definitions identify an executor and optional Academy retrieval tags. Capability selection filters availability, health, hardware, allowed IDs, location, cost, and latency, then ranks eligible options with a quality weight and benchmark signal. It returns considered options and reasons. The Production Director returns goals, stages, skill IDs, capability IDs, dependencies, input artifact IDs, and finishing skills. Deterministic validation rejects invented IDs, cycles, unknown inputs, and missing required stages.

The video adapter maps the current Editing Core evidence, planner, critic, and global repair results into a plan artifact, quality findings, and telemetry. It calls the current `buildCreativeEditPlan` service. The existing Editing Academy is referenced by the shared Academy contract; its content remains in place. The coding adapter is a scaffold. The video profile includes named media, edit, finishing, render, and inspection phases; optional augmentation phases follow intent.

## Repair, finishing, and safety

Repair proposals may reference only registered skills and capabilities, existing artifacts, repairable finding IDs, and scalar parameters. The bounded loop records resolved and introduced findings after every evaluation, stops at the profile limit or a plateau, and reports a normalized failure. Finishing is a separate stage. Both contracts call an explicit authorization callback before a registered executor can run and verify output lineage. The v1 API does not expose these execution callbacks, so it does not bypass Adobe worker, filesystem, Remote Ops, or approval controls.

## API and persistence

`GET /premium/skills`, `/capabilities`, `/domains`, and `/runs/:id` inspect registrations and stored runs. `POST /premium/plan` creates a validated run. `POST /premium/video/edit-plan` invokes the existing Editing Core planner for a video run and records its plan artifact and critic findings. `POST /premium/evaluate` maps a supplied Editing Core plan as *submitted plan evidence*; this is not a trusted rendered output review. `POST /premium/repair-plan` validates and stores only a proposed repair state; it performs no execution. Run snapshots are stored in `premium_pipeline_runs` in the existing `freeos.sqlite` database.

## v2 integration work

Connect registered executors to existing approved operations, add trusted rendered media evaluators and finishing implementations, wire source and render artifacts through persisted run lineage, populate capability health and benchmark results, and link governed continuous learning to accepted run summaries. Until these are integrated, a professional, premium, or maximum video run cannot pass final QC based on a plan alone.
