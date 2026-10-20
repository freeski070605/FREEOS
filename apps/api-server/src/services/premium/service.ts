import Database from "better-sqlite3";
import path from "node:path";
import { PremiumRegistry, createRun, qualityGate, currentEvaluations, validatePlan, type Artifact, type EvaluationResult, type PremiumPipelineRun, type ProductionDirector, type ProductionPlan, type QualityTarget, type RepairPlan, validateRepairPlan, recordRepair, plateauReason } from "./core";
import { codingAdapter, videoAdapter } from "./adapters";
import { reviewEditingPlan } from "./adapters";
import { buildCreativeEditPlan, type EditingPlannerRequest } from "../editingPlanner.service";
import { addArtifact } from "./core";
import { randomUUID } from "node:crypto";

export const premiumRegistry = new PremiumRegistry();
premiumRegistry.registerAdapter(videoAdapter);
premiumRegistry.registerAdapter(codingAdapter);
premiumRegistry.registerAcademyKnowledge({ id: "editing-academy.existing", domain: "video", kind: "workflow", retrievalTags: ["performance-multicam", "continuity-motivated-cuts"], reference: "skill-academy/photo-video.advanced-editing-v1" });
premiumRegistry.registerCapability({ id: "editing-core.local", provider: "FREEOS", type: "internal", domains: ["video"], taskTypes: ["analysis", "planning", "evaluation", "repair"], localOrRemote: "local", available: true, qualityProfile: 1, speedProfile: 1, costProfile: 0, supportedInputs: ["media", "edit-plan"], supportedOutputs: ["evidence", "edit-plan", "findings"], limitations: ["Plan review is distinct from rendered media review."] });
premiumRegistry.registerCapability({ id: "adobe-worker.review-render", provider: "Adobe", type: "render", domains: ["video"], taskTypes: ["render", "inspection"], localOrRemote: "local", available: true, qualityProfile: 1, speedProfile: 2, costProfile: 1, supportedInputs: ["video", "source-media"], supportedOutputs: ["video-review-render"], limitations: ["Review render is not final delivery."] });
premiumRegistry.registerExecutor({ id: "editing-core.executor", supportedSkills: ["video.evidence.analyze", "video.edit.plan", "video.edit.critique", "video.edit.repair"], supportedCapabilities: ["editing-core.local"], riskLevel: "medium", requiresApproval: false, execute: async ({ skillId, capabilityId, artifactId, parameters }) => ({ executionId: randomUUID(), skillId, capabilityId, success: true, producedArtifacts: [], modifiedArtifacts: [{ artifactId: artifactId ?? "", type: "edit-plan", domain: "video", sourceArtifacts: [], version: 1, status: "produced", lineage: { sourceArtifactIds: [], operation: skillId, evaluationIds: [] } }], warnings: [], errors: [], telemetry: { parameters, capabilityId }, executedAt: new Date().toISOString() }) });
premiumRegistry.registerExecutor({ id: "adobe-worker.review-render.executor", supportedSkills: ["video.render.review"], supportedCapabilities: ["adobe-worker.review-render"], riskLevel: "medium", requiresApproval: true, execute: async ({ skillId, capabilityId, artifactId, parameters }) => ({ executionId: randomUUID(), skillId, capabilityId, success: true, producedArtifacts: [{ artifactId: artifactId ?? randomUUID(), type: "video-review-render", domain: "video", sourceArtifacts: [artifactId ?? ""].filter(Boolean), version: 1, status: "produced", lineage: { sourceArtifactIds: [artifactId ?? ""].filter(Boolean), operation: skillId, evaluationIds: [], skillId, capabilityId } }], modifiedArtifacts: [], warnings: [], errors: [], telemetry: { parameters, capabilityId }, executedAt: new Date().toISOString() }) });
premiumRegistry.registerExecutor({ id: "adobe-worker.media-executor", supportedSkills: ["video.render.inspect", "video.color.basic-correction", "video.reframe", "video.transition.zoom", "video.effect.rgb-split", "video.effect.flash", "video.effect.temporal-echo", "video.finish"], supportedCapabilities: ["adobe-worker.review-render", "editing-core.local"], riskLevel: "high", requiresApproval: true, execute: async ({ skillId, capabilityId, artifactId, parameters }) => ({ executionId: randomUUID(), skillId, capabilityId, success: true, producedArtifacts: [], modifiedArtifacts: [], warnings: [], errors: [], telemetry: { parameters, capabilityId }, executedAt: new Date().toISOString() }) });

let database: Database.Database | undefined;
function db(): Database.Database {
  if (!database) { database = new Database(path.resolve(process.cwd(), "freeos.sqlite")); database.prepare("CREATE TABLE IF NOT EXISTS premium_pipeline_runs (run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, state_json TEXT NOT NULL)").run(); }
  return database;
}
export function saveRun(run: PremiumPipelineRun): void { db().prepare("INSERT INTO premium_pipeline_runs(run_id,task_id,domain,status,updated_at,state_json) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, state_json=excluded.state_json").run(run.runId, run.taskId, run.domain, run.status, new Date().toISOString(), JSON.stringify(run)); }
export function getRun(id: string): PremiumPipelineRun | undefined { const row = db().prepare("SELECT state_json FROM premium_pipeline_runs WHERE run_id=?").get(id) as { state_json: string } | undefined; return row ? JSON.parse(row.state_json) as PremiumPipelineRun : undefined; }

export function defaultDirector(): ProductionDirector { return { direct: (_intent, profile) => {
  const adapter = premiumRegistry.domains.get(profile.domain); if (!adapter) throw new Error("Unknown domain.");
  const skillIds = profile.domain === "video" ? ["video.evidence.analyze", "video.edit.plan", "video.edit.critique", ...(profile.requiredStages.includes("repair") ? ["video.edit.repair"] : []), ...(profile.requiredStages.includes("inspection") ? ["video.render.inspect", "video.render.review"] : []), ...(profile.requiredStages.includes("finishing") ? adapter.getFinishers() : [])] : [];
  return { goals: [profile.userIntent], stages: adapter.buildPipelineStages(profile), skillIds, capabilityIds: ["editing-core.local", "adobe-worker.review-render"].filter(() => profile.domain === "video"), dependencies: { "video.edit.plan": ["video.evidence.analyze"], "video.edit.critique": ["video.edit.plan"], "video.edit.repair": ["video.edit.critique"], "video.render.review": ["video.edit.plan"], "video.render.inspect": ["video.render.review"] }, artifactIds: [], finishingSkillIds: profile.requiredStages.includes("finishing") ? adapter.getFinishers() : [] };
} }; }
export async function planRun(taskId: string, domain: string, intent: string, targetQuality: QualityTarget, director = defaultDirector()): Promise<PremiumPipelineRun> {
  const adapter = premiumRegistry.domains.get(domain); if (!adapter) throw new Error("Unknown domain.");
  const profile = adapter.buildProductionProfile(adapter.understand(intent), targetQuality);
  const run = createRun(taskId, intent, profile);
  const plan: ProductionPlan = await director.direct(intent, profile);
  validatePlan(plan, profile, premiumRegistry, run.artifacts);
  run.productionPlan = plan; run.currentStage = "planning"; run.telemetry.skillsRequested = [...plan.skillIds]; run.telemetry.capabilitiesConsidered = [...plan.capabilityIds]; saveRun(run); return run;
}
export function evaluateRun(run: PremiumPipelineRun, artifact: Artifact, results: EvaluationResult[]): PremiumPipelineRun {
  if (!run.artifacts.some(a => a.artifactId === artifact.artifactId)) throw new Error("Unknown artifact.");
  for (const result of results) { if (!premiumRegistry.evaluators.has(result.evaluatorId) || result.artifactId !== artifact.artifactId) throw new Error("Unknown evaluator or artifact."); }
  run.evaluations.push(...results); run.telemetry.evaluationCount += results.length; run.currentStage = results.some(r => r.reviewType === "executed-artifact") ? "final-qc" : "evaluation";
  const gate = qualityGate(run.productionProfile, currentEvaluations(run.evaluations)); run.telemetry.qualityGateOutcome = gate.outcome; run.telemetry.findingsAfter = results.flatMap(r => r.findings.map(f => f.id)); saveRun(run); return run;
}
export function recordPlannedRepair(run: PremiumPipelineRun, plan: RepairPlan, before: EvaluationResult[], after: EvaluationResult[]): PremiumPipelineRun {
  validateRepairPlan(plan, before.flatMap(e => e.findings), run, premiumRegistry); recordRepair(run, plan, before, after); run.telemetry.plateauReason = plateauReason(run); saveRun(run); return run;
}
export async function produceVideoEditPlan(run: PremiumPipelineRun, input: EditingPlannerRequest): Promise<{ run: PremiumPipelineRun; plan: Awaited<ReturnType<typeof buildCreativeEditPlan>> }> {
  if (run.domain !== "video" || !run.productionPlan?.skillIds.includes("video.edit.plan")) throw new Error("Video planning skill not authorized for this run.");
  if (!input.audioPath || !Array.isArray(input.clips) || !input.clips.length || input.clips.some(c => !c.id || !c.path)) throw new Error("Grounded audio and clip inputs required.");
  const started = Date.now();
  const plan = await buildCreativeEditPlan(input);
  const sources: Artifact[] = [{ artifactId: randomUUID(), type: "audio", domain: "video", reference: input.audioPath, sourceArtifacts: [], version: 1, status: "produced", lineage: { sourceArtifactIds: [], operation: "user-source", evaluationIds: [] } }, ...input.clips.map(clip => ({ artifactId: randomUUID(), type: "video", domain: "video", reference: clip.path, sourceArtifacts: [], version: 1, status: "produced" as const, lineage: { sourceArtifactIds: [], operation: "user-source", evaluationIds: [] } }))];
  for (const source of sources) addArtifact(run, source);
  const sourceIds = sources.map(source => source.artifactId);
  const artifact: Artifact = { artifactId: randomUUID(), type: "edit-plan", domain: "video", sourceArtifacts: sourceIds, version: 1, status: "inspected", lineage: { sourceArtifactIds: sourceIds, operation: "editing-core-plan", skillId: "video.edit.plan", capabilityId: "editing-core.local", evaluationIds: [] } };
  addArtifact(run, artifact);
  const evaluation = reviewEditingPlan(plan, artifact); artifact.lineage.evaluationIds.push(evaluation.id);
  run.skillsUsed.push("video.evidence.analyze", "video.edit.plan", "video.edit.critique"); run.capabilitiesUsed.push("editing-core.local");
  run.telemetry.skillsExecuted.push(...run.skillsUsed); run.telemetry.capabilitiesSelected.push("editing-core.local"); run.telemetry.stageTimings.planning = Date.now() - started;
  run.telemetry.findingsBefore = (plan.evidence.initialCriticFindings ?? []).map(f => f.code);
  run.telemetry.resolvedFindings = (plan.evidence.resolvedFindings ?? []).map(f => f.code);
  run.telemetry.repairIterations = plan.evidence.globalRepairPasses ?? 0;
  evaluateRun(run, artifact, [evaluation]); run.status = "active"; saveRun(run);
  return { run, plan };
}
