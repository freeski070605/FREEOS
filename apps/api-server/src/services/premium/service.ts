import Database from "better-sqlite3";
import path from "node:path";
import { PremiumRegistry, createRun, qualityGate, currentEvaluations, validatePlan, type Artifact, type EvaluationResult, type PremiumPipelineRun, type ProductionDirector, type ProductionPlan, type QualityTarget, type RepairPlan, validateRepairPlan, recordRepair, plateauReason } from "./core";
import { codingAdapter, videoAdapter } from "./adapters";
import { reviewEditingPlan } from "./adapters";
import { buildCreativeEditPlan, type EditingPlannerRequest } from "../editingPlanner.service";
import { addArtifact } from "./core";
import { randomUUID } from "node:crypto";
import { adobeService } from "../adobe.service";

export const premiumRegistry = new PremiumRegistry();
premiumRegistry.registerAdapter(videoAdapter);
premiumRegistry.registerAdapter(codingAdapter);
premiumRegistry.registerAcademyKnowledge({ id: "editing-academy.existing", domain: "video", kind: "workflow", retrievalTags: ["performance-multicam", "continuity-motivated-cuts"], reference: "skill-academy/photo-video.advanced-editing-v1" });
premiumRegistry.registerCapability({ id: "editing-core.local", provider: "FREEOS", type: "internal", domains: ["video"], taskTypes: ["analysis", "planning", "evaluation", "repair"], localOrRemote: "local", available: true, qualityProfile: 1, speedProfile: 1, costProfile: 0, supportedInputs: ["media", "edit-plan"], supportedOutputs: ["evidence", "edit-plan", "findings"], limitations: ["Plan review is distinct from rendered media review."] });
premiumRegistry.registerCapability({ id: "adobe-worker.review-render", provider: "Adobe", type: "render", domains: ["video"], taskTypes: ["render", "inspection", "repair"], localOrRemote: "local", available: true, healthCheck: () => { const status = adobeService.status(); return !!status.online && status.capabilities.some(c => c.application === "premiere" && c.action === "sequence.render" && c.available); }, qualityProfile: 1, speedProfile: 2, costProfile: 1, supportedInputs: ["video", "source-media"], supportedOutputs: ["video-review-render"], limitations: ["Review render is not final delivery."] });
premiumRegistry.registerExecutor({ id: "editing-core.executor", supportedSkills: ["video.evidence.analyze", "video.edit.plan", "video.edit.critique", "video.edit.repair"], supportedCapabilities: ["editing-core.local"], riskLevel: "medium", requiresApproval: false, execute: async ({ skillId, capabilityId, artifactId, parameters }) => ({ executionId: randomUUID(), skillId, capabilityId, success: true, producedArtifacts: [], modifiedArtifacts: [{ artifactId: artifactId ?? "", type: "edit-plan", domain: "video", sourceArtifacts: [], version: 1, status: "produced", lineage: { sourceArtifactIds: [], operation: skillId, evaluationIds: [] } }], warnings: [], errors: [], telemetry: { parameters, capabilityId }, executedAt: new Date().toISOString() }) });
premiumRegistry.registerExecutor({ id: "adobe-worker.review-render.executor", supportedSkills: ["video.render.review"], supportedCapabilities: ["adobe-worker.review-render"], riskLevel: "medium", requiresApproval: true, execute: async ({ runId, skillId, capabilityId, artifactId, parameters }) => {
  const run = runId ? getRun(runId) : undefined;
  if (!run || !artifactId || !run.artifacts.some(a => a.artifactId === artifactId)) throw new Error("Review render requires a persisted run and known plan artifact.");
  const projectPath = String(parameters.projectPath || ""), sequenceId = String(parameters.sequenceId || ""), presetPath = String(parameters.presetPath || ""), outputPath = String(parameters.outputPath || "");
  if (!projectPath || !sequenceId || !presetPath || !outputPath) throw new Error("Explicit project, sequence, preset and output paths are required.");
  const prior = run.artifacts.filter(a => a.type === "video-review-render").at(-1);
  const version = prior ? prior.version + 1 : 1;
  if (!new RegExp(`review-v${version}\\.mp4$`, "i").test(outputPath)) throw new Error(`Review output must end in review-v${version}.mp4.`);
  const output = await adobeService.run("premiere", "sequence.render", { projectPath, sequenceId, presetPath, outputPath }, 3_700_000) as { path?: string; probe?: { format?: { duration?: string }; streams?: Array<{ codec_type: string; width?: number; height?: number; avg_frame_rate?: string; codec_name?: string }> }; filesize?: number; createdAt?: string };
  if (!output.path || path.resolve(output.path).toLowerCase() !== path.resolve(outputPath).toLowerCase() || !output.filesize || !output.probe?.streams?.some(s => s.codec_type === "video")) throw new Error("Adobe worker did not verify a real review render.");
  const executionId = randomUUID();
  const sourceArtifactIds = [...new Set([artifactId, ...(prior ? [prior.artifactId] : [])])];
  const artifact: Artifact = { artifactId: randomUUID(), type: "video-review-render", domain: "video", reference: output.path, mimeType: "video/mp4", metadata: { path: output.path, filesize: output.filesize, createdAt: output.createdAt, probe: output.probe }, sourceArtifacts: sourceArtifactIds, version, status: "produced", lineage: { sourceArtifactIds, operation: skillId, skillId, capabilityId, evaluationIds: [], runId, projectPath, sequenceId, planArtifactId: artifactId, executionIds: [executionId], ...(prior ? { previousVersionId: prior.artifactId } : {}) } };
  return { executionId, skillId, capabilityId, success: true, producedArtifacts: [artifact], modifiedArtifacts: [], warnings: [], errors: [], telemetry: { realRender: true, outputPath, filesize: output.filesize }, executedAt: new Date().toISOString() };
} });
premiumRegistry.registerExecutor({ id: "adobe-worker.final-render.executor", supportedSkills: ["video.render.final"], supportedCapabilities: ["adobe-worker.review-render"], riskLevel: "high", requiresApproval: true, execute: async ({ runId, skillId, capabilityId, parameters }) => {
  const run = runId ? getRun(runId) : undefined;
  const review = run?.artifacts.filter(a => a.type === "video-review-render").at(-1);
  const evaluation = review && run?.evaluations.find(e => e.artifactId === review.artifactId && e.source === "real-render-quality");
  if (!run || run.status !== "accepted" || !review?.reference || !evaluation || qualityGate(run.productionProfile, currentEvaluations(run.evaluations)).outcome !== "PASS") throw new Error("Final render requires an accepted real review artifact and passing gate.");
  const outputPath = String(parameters.outputPath || ""), presetPath = String(parameters.presetPath || "");
  if (!outputPath || !presetPath || path.resolve(outputPath).toLowerCase() === path.resolve(review.reference).toLowerCase()) throw new Error("Separate final output and delivery preset required.");
  const output = await adobeService.run("premiere", "sequence.render", { projectPath: review.lineage.projectPath, sequenceId: review.lineage.sequenceId, outputPath, presetPath }, 3_700_000) as { path?: string; probe?: unknown; filesize?: number; createdAt?: string };
  if (!output.path || path.resolve(output.path).toLowerCase() !== path.resolve(outputPath).toLowerCase() || !output.probe || !output.filesize) throw new Error("Adobe worker did not verify the final render.");
  const executionId = randomUUID();
  const artifact: Artifact = { artifactId: randomUUID(), type: "final-delivery", domain: "video", reference: output.path, mimeType: "video/mp4", metadata: { path: output.path, probe: output.probe, filesize: output.filesize, createdAt: output.createdAt }, sourceArtifacts: [review.artifactId], version: 1, status: "produced", lineage: { sourceArtifactIds: [review.artifactId], operation: skillId, skillId, capabilityId, evaluationIds: [], runId, projectPath: review.lineage.projectPath, sequenceId: review.lineage.sequenceId, executionIds: [executionId] } };
  return { executionId, skillId, capabilityId, success: true, producedArtifacts: [artifact], modifiedArtifacts: [], warnings: [], errors: [], telemetry: { realRender: true, outputPath }, executedAt: new Date().toISOString() };
} });
premiumRegistry.registerExecutor({ id: "adobe-worker.effect-remove.executor", supportedSkills: ["video.effect.remove"], supportedCapabilities: ["adobe-worker.review-render"], riskLevel: "high", requiresApproval: true, execute: async ({ runId, skillId, capabilityId, artifactId, parameters }) => {
  const run = runId ? getRun(runId) : undefined;
  const review = run?.artifacts.find(a => a.artifactId === artifactId && a.type === "video-review-render");
  if (!run || !review?.lineage.projectPath || !review.lineage.sequenceId || !run.pendingRepairPlan?.repairs.some(r => r.skillId === skillId && r.inputArtifactIds.includes(artifactId!))) throw new Error("A grounded pending repair plan and review artifact are required.");
  const result = await adobeService.run("premiere", "sequence.effect.remove", { projectPath: review.lineage.projectPath, sequenceId: review.lineage.sequenceId, ...parameters }, 180_000);
  return { executionId: randomUUID(), skillId, capabilityId, success: true, producedArtifacts: [], modifiedArtifacts: [], warnings: [], errors: [], telemetry: { adobeResult: result }, executedAt: new Date().toISOString() };
} });
premiumRegistry.registerExecutor({ id: "adobe-worker.media-executor", supportedSkills: ["video.render.inspect", "video.color.basic-correction", "video.reframe", "video.transition.zoom", "video.effect.rgb-split", "video.effect.flash", "video.effect.temporal-echo", "video.finish"], supportedCapabilities: ["adobe-worker.review-render", "editing-core.local"], riskLevel: "high", requiresApproval: true, execute: async ({ skillId }) => { throw new Error(`Registered Adobe skill ${skillId} has no verified execution adapter.`); } });

let database: Database.Database | undefined;
function db(): Database.Database {
  if (!database) { database = new Database(path.resolve(process.cwd(), "freeos.sqlite")); database.prepare("CREATE TABLE IF NOT EXISTS premium_pipeline_runs (run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, state_json TEXT NOT NULL)").run(); }
  return database;
}
export function saveRun(run: PremiumPipelineRun): void { db().prepare("INSERT INTO premium_pipeline_runs(run_id,task_id,domain,status,updated_at,state_json) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, state_json=excluded.state_json").run(run.runId, run.taskId, run.domain, run.status, new Date().toISOString(), JSON.stringify(run)); }
export function getRun(id: string): PremiumPipelineRun | undefined { const row = db().prepare("SELECT state_json FROM premium_pipeline_runs WHERE run_id=?").get(id) as { state_json: string } | undefined; return row ? JSON.parse(row.state_json) as PremiumPipelineRun : undefined; }
export function closePremiumRunStore(): void { database?.close(); database = undefined; }

export function defaultDirector(): ProductionDirector { return { direct: (_intent, profile) => {
  const adapter = premiumRegistry.domains.get(profile.domain); if (!adapter) throw new Error("Unknown domain.");
  const skillIds = profile.domain === "video" ? ["video.evidence.analyze", "video.edit.plan", "video.edit.critique", ...(profile.requiredStages.includes("repair") ? ["video.edit.repair"] : []), ...(profile.requiredStages.includes("inspection") ? ["video.render.inspect", "video.render.review"] : []), ...(profile.requiredStages.includes("finishing") ? adapter.getFinishers() : [])] : [];
  return { goals: [profile.userIntent], stages: adapter.buildPipelineStages(profile), skillIds, capabilityIds: ["editing-core.local"].filter(() => profile.domain === "video"), dependencies: { "video.edit.plan": ["video.evidence.analyze"], "video.edit.critique": ["video.edit.plan"], "video.edit.repair": ["video.edit.critique"], "video.render.review": ["video.edit.plan"], "video.render.inspect": ["video.render.review"] }, artifactIds: [], finishingSkillIds: profile.requiredStages.includes("finishing") ? adapter.getFinishers() : [] };
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
  const artifact: Artifact = { artifactId: randomUUID(), type: "edit-plan", domain: "video", metadata: { decisions: plan.decisions.map(d => ({ start: d.start, end: d.end, clipId: d.clipId, action: d.action })) }, sourceArtifacts: sourceIds, version: 1, status: "inspected", lineage: { sourceArtifactIds: sourceIds, operation: "editing-core-plan", skillId: "video.edit.plan", capabilityId: "editing-core.local", evaluationIds: [] } };
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
