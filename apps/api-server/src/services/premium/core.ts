import { randomUUID } from "node:crypto";

export const QUALITY_TARGETS = ["draft", "standard", "professional", "premium", "maximum"] as const;
export type QualityTarget = typeof QUALITY_TARGETS[number];
export type Stage = "intake" | "direction" | "planning" | "production" | "inspection" | "evaluation" | "repair" | "finishing" | "final-qc" | "accepted" | "rejected" | "delivered";
export type FailureCode = "execution-failure" | "infrastructure-failure" | "quality-failure" | "capability-unavailable" | "skill-unavailable" | "creative-nonconvergence" | "resource-limit" | "constraint-conflict" | "validation-failure";
export const FAILURE_CODES: FailureCode[] = ["execution-failure", "infrastructure-failure", "quality-failure", "capability-unavailable", "skill-unavailable", "creative-nonconvergence", "resource-limit", "constraint-conflict", "validation-failure"];
export const STAGES: Stage[] = ["intake", "direction", "planning", "production", "inspection", "evaluation", "repair", "finishing", "final-qc", "accepted", "rejected", "delivered"];

export function qualityTarget(value: unknown): QualityTarget {
  if (!QUALITY_TARGETS.includes(value as QualityTarget)) throw new Error("Unknown quality target.");
  return value as QualityTarget;
}

export interface QualityDimension { id: string; description: string; importance: number; required: boolean; threshold?: number }
export interface ProductionProfile { domain: string; targetQuality: QualityTarget; userIntent: string; requiredStages: Stage[]; optionalStages: Stage[]; domainStages?: string[]; qualityDimensions: QualityDimension[]; constraints: { maxCost?: number; maxLatencyMs?: number; localOnly?: boolean; allowedCapabilityIds?: string[] }; allowedRepairIterations: number; deliveryRequirements: string[] }
export interface SkillDefinition { id: string; domain: string; category: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>; repairParameterSchema?: Record<string, { type: "string" | "number" | "boolean"; min?: number; max?: number; choices?: string[] }>; qualityCapabilities: string[]; requiredCapabilities: string[]; executorId: string; prerequisites: string[]; producesArtifacts: string[]; evaluationHints: string[]; academyTags?: string[] }
export interface CapabilityDefinition { id: string; provider: string; type: string; domains: string[]; taskTypes: string[]; localOrRemote: "local" | "remote"; available: boolean; qualityProfile: number; speedProfile: number; costProfile: number; hardwareRequirements?: string[]; supportedInputs: string[]; supportedOutputs: string[]; limitations: string[]; benchmarkScore?: number; healthCheck?: () => boolean }
export interface ArtifactLineage { sourceArtifactIds: string[]; operation: string; skillId?: string; capabilityId?: string; evaluationIds: string[]; repairId?: string; previousVersionId?: string }
export interface Artifact { artifactId: string; type: string; domain: string; reference?: string; mimeType?: string; sourceArtifacts: string[]; generatedBySkill?: string; generatedByCapability?: string; version: number; status: "planned" | "produced" | "inspected" | "accepted" | "rejected"; qualityState?: string; lineage: ArtifactLineage }
export interface QualityFinding { id: string; domain: string; artifactId: string; category: string; severity: "info" | "warning" | "material" | "blocking"; description: string; evidence: unknown[]; confidence: number; repairable: boolean; suggestedSkillCategories: string[] }
export interface DimensionScore { dimensionId: string; score: number; measurementType: string; confidence: number }
export interface EvaluationResult { id: string; evaluatorId: string; artifactId: string; reviewType: "plan" | "executed-artifact"; dimensionScores: DimensionScore[]; findings: QualityFinding[]; evidence: unknown[]; confidence: number; status: "complete" | "inconclusive"; source: string }
export interface ExecutedArtifactReview { artifactId: string; technicalFindings: QualityFinding[]; creativeFindings: QualityFinding[]; consistencyFindings: QualityFinding[]; evaluatorResults: EvaluationResult[]; repairRecommended: boolean }
export interface EvaluatorDefinition { id: string; domain: string; dimensions: string[]; supportedArtifactTypes: string[]; measurementType: string; evaluate: (artifact: Artifact, profile: ProductionProfile) => Promise<EvaluationResult> | EvaluationResult }
export interface BenchmarkDefinition { id: string; domain: string; fixture: string; qualityTarget: QualityTarget; expectedProperties: string[]; regressionRules: string[] }
export interface AcademyKnowledge { id: string; domain: string; kind: "principle" | "workflow" | "failure-pattern" | "tool-knowledge" | "quality-criterion" | "best-practice"; retrievalTags: string[]; reference: string }
export interface ProductionPlan { goals: string[]; stages: Stage[]; skillIds: string[]; capabilityIds: string[]; dependencies: Record<string, string[]>; artifactIds: string[]; finishingSkillIds: string[] }
export interface ProductionDirector { direct(intent: string, profile: ProductionProfile): Promise<ProductionPlan> | ProductionPlan }
export interface PremiumDomainAdapter { domainId: string; understand(intent: string): string; buildProductionProfile(intent: string, target: QualityTarget): ProductionProfile; buildPipelineStages(profile: ProductionProfile): Stage[]; getSkills(): SkillDefinition[]; getEvaluators(): EvaluatorDefinition[]; getFinishers(): string[]; getBenchmarks(): BenchmarkDefinition[] }
export interface RepairAction { id: string; findingIds: string[]; skillId: string; capabilityId: string; inputArtifactIds: string[]; parameters: Record<string, string | number | boolean>; expectedQualityEffect: string }
export interface RepairPlan { repairs: RepairAction[] }
export interface RepairPlanner { plan(artifact: Artifact, findings: QualityFinding[], profile: ProductionProfile, history: RepairRecord[]): Promise<RepairPlan> | RepairPlan }
export interface ApprovedSkillExecutor { authorize(skill: SkillDefinition, capability: CapabilityDefinition, artifact: Artifact, stage: Stage): Promise<boolean> | boolean; execute(skill: SkillDefinition, capability: CapabilityDefinition, artifact: Artifact, parameters: Record<string, string | number | boolean>): Promise<Artifact> }
export interface RepairRecord { iteration: number; beforeEvaluationIds: string[]; afterEvaluationIds: string[]; resolvedFindingIds: string[]; introducedFindingIds: string[]; skillIds: string[]; capabilityIds: string[]; reason?: string }
export interface QualityGateResult { outcome: "PASS" | "PASS_WITH_WARNINGS" | "FAIL"; reasons: string[]; override?: { userId: string; reason: string } }
export interface PipelineTelemetry { stageTimings: Record<string, number>; skillsRequested: string[]; skillsExecuted: string[]; capabilitiesConsidered: string[]; capabilitiesSelected: string[]; artifactVersions: Record<string, number>; evaluationCount: number; repairIterations: number; findingsBefore: string[]; findingsAfter: string[]; resolvedFindings: string[]; introducedFindings: string[]; qualityGateOutcome?: QualityGateResult["outcome"]; acceptanceReason?: string; plateauReason?: string }
export interface PremiumPipelineRun { runId: string; taskId: string; domain: string; userIntent: string; targetQuality: QualityTarget; currentStage: Stage; productionProfile: ProductionProfile; productionPlan?: ProductionPlan; pendingRepairPlan?: RepairPlan; artifacts: Artifact[]; skillsUsed: string[]; capabilitiesUsed: string[]; evaluations: EvaluationResult[]; repairs: RepairRecord[]; status: "planned" | "active" | "accepted" | "rejected" | "delivered"; failure?: { code: FailureCode; detail: string }; telemetry: PipelineTelemetry }

function unique<T extends { id: string }>(map: Map<string, T>, item: T): void {
  if (!item.id || map.has(item.id)) throw new Error(`Duplicate or empty registration: ${item.id}`);
  map.set(item.id, item);
}
export class PremiumRegistry {
  readonly domains = new Map<string, PremiumDomainAdapter>();
  readonly skills = new Map<string, SkillDefinition>();
  readonly capabilities = new Map<string, CapabilityDefinition>();
  readonly evaluators = new Map<string, EvaluatorDefinition>();
  readonly benchmarks = new Map<string, BenchmarkDefinition>();
  readonly academy = new Map<string, AcademyKnowledge>();
  registerDomain(adapter: PremiumDomainAdapter): void { if (!adapter.domainId || this.domains.has(adapter.domainId)) throw new Error("Duplicate or empty domain."); this.domains.set(adapter.domainId, adapter); }
  registerSkill(skill: SkillDefinition): void { if (!this.domains.has(skill.domain)) throw new Error("Unknown skill domain."); unique(this.skills, skill); }
  registerCapability(capability: CapabilityDefinition): void { unique(this.capabilities, capability); }
  registerEvaluator(evaluator: EvaluatorDefinition): void { if (!this.domains.has(evaluator.domain)) throw new Error("Unknown evaluator domain."); unique(this.evaluators, evaluator); }
  registerBenchmark(benchmark: BenchmarkDefinition): void { if (!this.domains.has(benchmark.domain)) throw new Error("Unknown benchmark domain."); unique(this.benchmarks, benchmark); }
  registerAcademyKnowledge(item: AcademyKnowledge): void { unique(this.academy, item); }
  knowledgeForSkill(skillId: string): AcademyKnowledge[] { const skill = this.requireSkill(skillId); return [...this.academy.values()].filter(k => k.domain === skill.domain && k.retrievalTags.some(t => skill.academyTags?.includes(t))); }
  requireSkill(id: string): SkillDefinition { const skill = this.skills.get(id); if (!skill) throw new Error(`Unknown skill: ${id}`); return skill; }
  requireCapability(id: string): CapabilityDefinition { const capability = this.capabilities.get(id); if (!capability) throw new Error(`Unknown capability: ${id}`); return capability; }
  registerAdapter(adapter: PremiumDomainAdapter): void { this.registerDomain(adapter); for (const skill of adapter.getSkills()) this.registerSkill(skill); for (const evaluator of adapter.getEvaluators()) this.registerEvaluator(evaluator); for (const benchmark of adapter.getBenchmarks()) this.registerBenchmark(benchmark); }
}

export function selectCapability(registry: PremiumRegistry, skillId: string, profile: ProductionProfile, hardware: string[] = []): { selected: CapabilityDefinition; considered: { id: string; eligible: boolean; reason: string; score?: number }[] } {
  const skill = registry.requireSkill(skillId);
  const considered = [...registry.capabilities.values()].filter(c => c.domains.includes(skill.domain) && c.taskTypes.includes(skill.category)).map(c => {
    const reason = !c.available || c.healthCheck?.() === false ? "unavailable" : profile.constraints.localOnly && c.localOrRemote !== "local" ? "local-only" : profile.constraints.allowedCapabilityIds && !profile.constraints.allowedCapabilityIds.includes(c.id) ? "not-allowed" : c.hardwareRequirements?.some(h => !hardware.includes(h)) ? "hardware" : profile.constraints.maxCost !== undefined && c.costProfile > profile.constraints.maxCost ? "cost" : profile.constraints.maxLatencyMs !== undefined && c.speedProfile > profile.constraints.maxLatencyMs ? "latency" : skill.requiredCapabilities.length && !skill.requiredCapabilities.includes(c.id) ? "skill-requirement" : "eligible";
    const weight = { draft: 1, standard: 2, professional: 4, premium: 6, maximum: 8 }[profile.targetQuality];
    return { id: c.id, eligible: reason === "eligible", reason, score: reason === "eligible" ? c.qualityProfile * weight + (c.benchmarkScore ?? 0) * weight - c.costProfile - c.speedProfile / 1000 : undefined };
  });
  const best = considered.filter(c => c.eligible).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!best) throw new Error("capability-unavailable");
  return { selected: registry.requireCapability(best.id), considered };
}

export function validatePlan(plan: ProductionPlan, profile: ProductionProfile, registry: PremiumRegistry, artifacts: Artifact[]): void {
  if (!plan.stages.every(s => STAGES.includes(s)) || !profile.requiredStages.every(s => plan.stages.includes(s))) throw new Error("Invalid or missing pipeline stage.");
  if (!plan.finishingSkillIds.every(id => plan.skillIds.includes(id)) || (profile.requiredStages.includes("finishing") && !plan.stages.includes("finishing"))) throw new Error("Finishing requirement missing.");
  for (const id of plan.skillIds) { const skill = registry.requireSkill(id); if (skill.domain !== profile.domain) throw new Error("Skill domain mismatch."); }
  for (const id of plan.capabilityIds) { const c = registry.requireCapability(id); if (!c.available || c.healthCheck?.() === false) throw new Error("capability-unavailable"); if (!c.domains.includes(profile.domain)) throw new Error("Capability domain mismatch."); }
  for (const id of plan.artifactIds) if (!artifacts.some(a => a.artifactId === id)) throw new Error("Ungrounded artifact input.");
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => { if (!plan.skillIds.includes(id)) throw new Error("Unknown dependency."); if (visiting.has(id)) throw new Error("Cyclic dependency."); if (visited.has(id)) return; visiting.add(id); for (const dep of plan.dependencies[id] ?? []) visit(dep); visiting.delete(id); visited.add(id); };
  for (const id of plan.skillIds) visit(id);
}

export function addArtifact(run: PremiumPipelineRun, artifact: Artifact): void {
  if (run.artifacts.some(a => a.artifactId === artifact.artifactId)) throw new Error("Duplicate artifact.");
  if (artifact.domain !== run.domain || artifact.version < 1) throw new Error("Invalid artifact.");
  if (artifact.sourceArtifacts.length !== artifact.lineage.sourceArtifactIds.length || artifact.sourceArtifacts.some(id => !artifact.lineage.sourceArtifactIds.includes(id))) throw new Error("Artifact lineage source mismatch.");
  for (const id of artifact.sourceArtifacts) if (!run.artifacts.some(a => a.artifactId === id)) throw new Error("Unknown source artifact.");
  if (artifact.lineage.previousVersionId) { const prior = run.artifacts.find(a => a.artifactId === artifact.lineage.previousVersionId); if (!prior || artifact.version !== prior.version + 1) throw new Error("Invalid artifact version lineage."); }
  run.artifacts.push(artifact); run.telemetry.artifactVersions[artifact.artifactId] = artifact.version;
}
export function aggregateEvaluations(results: EvaluationResult[]): { dimensions: Record<string, { score: number; confidence: number; measurementTypes: string[] }>; findings: QualityFinding[] } {
  const groups = new Map<string, DimensionScore[]>();
  for (const result of results.filter(r => r.status === "complete")) for (const score of result.dimensionScores) groups.set(score.dimensionId, [...(groups.get(score.dimensionId) ?? []), score]);
  const dimensions: Record<string, { score: number; confidence: number; measurementTypes: string[] }> = {};
  for (const [id, scores] of groups) { const weight = scores.reduce((n, s) => n + s.confidence, 0); dimensions[id] = { score: weight ? scores.reduce((n, s) => n + s.score * s.confidence, 0) / weight : 0, confidence: scores.reduce((n, s) => n + s.confidence, 0) / scores.length, measurementTypes: [...new Set(scores.map(s => s.measurementType))] }; }
  return { dimensions, findings: results.flatMap(r => r.findings) };
}
export function currentEvaluations(results: EvaluationResult[]): EvaluationResult[] {
  const latest = new Map<string, EvaluationResult>();
  for (const result of results) latest.set(`${result.evaluatorId}:${result.reviewType}`, result);
  return [...latest.values()];
}
export function qualityGate(profile: ProductionProfile, results: EvaluationResult[], override?: { userId: string; reason: string }): QualityGateResult {
  const aggregate = aggregateEvaluations(results);
  const reasons: string[] = [];
  for (const dimension of profile.qualityDimensions.filter(d => d.required)) { const actual = aggregate.dimensions[dimension.id]; if (!actual || (dimension.threshold !== undefined && actual.score < dimension.threshold)) reasons.push(`Required dimension failed: ${dimension.id}`); }
  for (const finding of aggregate.findings) if (finding.severity === "blocking" || finding.severity === "material" && profile.targetQuality !== "draft") reasons.push(`Material finding: ${finding.id}`);
  if (profile.requiredStages.includes("final-qc") && !results.some(r => r.reviewType === "executed-artifact" && r.status === "complete")) reasons.push("Executed artifact review required.");
  if (reasons.length && !override) return { outcome: "FAIL", reasons };
  if (override && (!override.userId || !override.reason)) throw new Error("Explicit user override requires identity and reason.");
  return { outcome: reasons.length || aggregate.findings.some(f => f.severity === "warning") ? "PASS_WITH_WARNINGS" : "PASS", reasons, ...(override ? { override } : {}) };
}
export function executedArtifactReview(artifactId: string, results: EvaluationResult[]): ExecutedArtifactReview {
  if (results.some(r => r.artifactId !== artifactId || r.reviewType !== "executed-artifact")) throw new Error("Plan review cannot stand in for artifact review.");
  const findings = results.flatMap(r => r.findings);
  return { artifactId, technicalFindings: findings.filter(f => f.category === "technical"), creativeFindings: findings.filter(f => f.category === "creative"), consistencyFindings: findings.filter(f => f.category === "consistency"), evaluatorResults: results, repairRecommended: findings.some(f => f.repairable && (f.severity === "material" || f.severity === "blocking")) };
}
export function validateRepairPlan(plan: RepairPlan, findings: QualityFinding[], run: PremiumPipelineRun, registry: PremiumRegistry): void {
  if (run.repairs.length >= run.productionProfile.allowedRepairIterations) throw new Error("Repair iteration limit reached.");
  for (const repair of plan.repairs) { const skill = registry.requireSkill(repair.skillId), capability = registry.requireCapability(repair.capabilityId); if (skill.domain !== run.domain || !capability.available || !capability.domains.includes(run.domain) || !capability.taskTypes.includes(skill.category) || skill.requiredCapabilities.length > 0 && !skill.requiredCapabilities.includes(capability.id)) throw new Error("Invalid repair capability or domain."); if (!repair.findingIds.length || !repair.findingIds.every(id => findings.some(f => f.id === id && f.repairable))) throw new Error("Ungrounded repair finding."); if (!repair.inputArtifactIds.length || !repair.inputArtifactIds.every(id => run.artifacts.some(a => a.artifactId === id))) throw new Error("Ungrounded repair input."); for (const [key, value] of Object.entries(repair.parameters)) { const rule = skill.repairParameterSchema?.[key]; if (!rule || typeof value !== rule.type || typeof value === "number" && (!Number.isFinite(value) || rule.min !== undefined && value < rule.min || rule.max !== undefined && value > rule.max) || typeof value === "string" && rule.choices && !rule.choices.includes(value)) throw new Error("Unbounded repair parameter."); } }
}
export function recordRepair(run: PremiumPipelineRun, plan: RepairPlan, before: EvaluationResult[], after: EvaluationResult[]): RepairRecord {
  const previous = new Set(before.flatMap(e => e.findings.map(f => f.id))), next = new Set(after.flatMap(e => e.findings.map(f => f.id)));
  const record: RepairRecord = { iteration: run.repairs.length + 1, beforeEvaluationIds: before.map(e => e.id), afterEvaluationIds: after.map(e => e.id), resolvedFindingIds: [...previous].filter(id => !next.has(id)), introducedFindingIds: [...next].filter(id => !previous.has(id)), skillIds: plan.repairs.map(r => r.skillId), capabilityIds: plan.repairs.map(r => r.capabilityId) };
  if (record.iteration > run.productionProfile.allowedRepairIterations) throw new Error("Repair iteration limit reached.");
  run.repairs.push(record); run.telemetry.repairIterations = run.repairs.length; run.telemetry.resolvedFindings.push(...record.resolvedFindingIds); run.telemetry.introducedFindings.push(...record.introducedFindingIds); return record;
}
export function plateauReason(run: PremiumPipelineRun, minimumPasses = 2): string | undefined {
  if (run.repairs.length < minimumPasses) return undefined;
  const recent = run.repairs.slice(-minimumPasses);
  if (recent.every(r => r.resolvedFindingIds.length === 0)) return "No findings resolved in recent repair passes.";
  if (recent.every(r => r.introducedFindingIds.length >= r.resolvedFindingIds.length)) return "Repairs introduced at least as many findings as they resolved.";
  return undefined;
}
export function createRun(taskId: string, intent: string, profile: ProductionProfile): PremiumPipelineRun {
  if (!taskId || !intent || !Number.isInteger(profile.allowedRepairIterations) || profile.allowedRepairIterations < 0) throw new Error("Invalid pipeline input.");
  qualityTarget(profile.targetQuality);
  return { runId: randomUUID(), taskId, domain: profile.domain, userIntent: intent, targetQuality: profile.targetQuality, currentStage: "intake", productionProfile: profile, artifacts: [], skillsUsed: [], capabilitiesUsed: [], evaluations: [], repairs: [], status: "planned", telemetry: { stageTimings: {}, skillsRequested: [], skillsExecuted: [], capabilitiesConsidered: [], capabilitiesSelected: [], artifactVersions: {}, evaluationCount: 0, repairIterations: 0, findingsBefore: [], findingsAfter: [], resolvedFindings: [], introducedFindings: [] } };
}
export async function runFinishing(run: PremiumPipelineRun, artifact: Artifact, finisherId: string, capabilityId: string, registry: PremiumRegistry, executor: ApprovedSkillExecutor): Promise<Artifact> {
  if (!run.productionProfile.requiredStages.includes("finishing") && !run.productionProfile.optionalStages.includes("finishing")) throw new Error("Finishing not in profile.");
  if (!run.artifacts.some(a => a.artifactId === artifact.artifactId)) throw new Error("Unknown finishing input.");
  const skill = registry.requireSkill(finisherId), capability = registry.requireCapability(capabilityId);
  if (skill.domain !== run.domain || skill.category !== "finishing" || !capability.available || !capability.domains.includes(run.domain) || !capability.taskTypes.includes(skill.category)) throw new Error("Invalid finisher capability.");
  if (!await executor.authorize(skill, capability, artifact, "finishing")) throw new Error("Execution approval denied.");
  const output = await executor.execute(skill, capability, artifact, {});
  if (output.domain !== run.domain || !output.sourceArtifacts.includes(artifact.artifactId) || output.generatedBySkill !== finisherId || output.generatedByCapability !== capabilityId) throw new Error("Invalid finishing lineage.");
  addArtifact(run, output); run.currentStage = "finishing"; run.skillsUsed.push(finisherId); run.capabilitiesUsed.push(capabilityId); return output;
}
export async function runBoundedRepairLoop(run: PremiumPipelineRun, artifact: Artifact, registry: PremiumRegistry, planner: RepairPlanner, executor: ApprovedSkillExecutor, evaluate: (artifact: Artifact) => Promise<EvaluationResult[]>, onProgress?: (run: PremiumPipelineRun) => void): Promise<QualityGateResult> {
  if (!run.artifacts.some(a => a.artifactId === artifact.artifactId)) throw new Error("Unknown repair artifact.");
  let current = artifact;
  let before = await evaluate(current);
  run.evaluations.push(...before); run.telemetry.evaluationCount += before.length;
  for (;;) {
    const gate = qualityGate(run.productionProfile, before);
    run.telemetry.qualityGateOutcome = gate.outcome;
    if (gate.outcome !== "FAIL") { run.currentStage = "accepted"; run.status = "accepted"; run.telemetry.acceptanceReason = gate.outcome; onProgress?.(run); return gate; }
    if (run.repairs.length >= run.productionProfile.allowedRepairIterations) { run.failure = { code: "quality-failure", detail: "Repair iteration limit reached." }; break; }
    const plateau = plateauReason(run);
    if (plateau) { run.telemetry.plateauReason = plateau; run.failure = { code: "creative-nonconvergence", detail: plateau }; break; }
    const plan = await planner.plan(current, before.flatMap(e => e.findings), run.productionProfile, run.repairs);
    if (!plan.repairs.length) { run.failure = { code: "skill-unavailable", detail: "No legal repair proposed." }; break; }
    validateRepairPlan(plan, before.flatMap(e => e.findings), run, registry);
    run.currentStage = "repair";
    for (const repair of plan.repairs) {
      const skill = registry.requireSkill(repair.skillId), capability = registry.requireCapability(repair.capabilityId);
      if (!await executor.authorize(skill, capability, current, "repair")) { run.failure = { code: "validation-failure", detail: "Execution approval denied." }; run.status = "rejected"; run.currentStage = "rejected"; onProgress?.(run); return { outcome: "FAIL", reasons: [run.failure.detail] }; }
      const output = await executor.execute(skill, capability, current, repair.parameters);
      if (output.domain !== run.domain || !output.sourceArtifacts.includes(current.artifactId) || output.generatedBySkill !== skill.id || output.generatedByCapability !== capability.id) throw new Error("Invalid repair lineage.");
      addArtifact(run, output); current = output; run.skillsUsed.push(skill.id); run.capabilitiesUsed.push(capability.id);
    }
    const after = await evaluate(current);
    run.evaluations.push(...after); run.telemetry.evaluationCount += after.length;
    recordRepair(run, plan, before, after);
    before = after; onProgress?.(run);
  }
  run.status = "rejected"; run.currentStage = "rejected"; run.telemetry.acceptanceReason = run.failure?.detail; onProgress?.(run);
  return { outcome: "FAIL", reasons: [run.failure?.detail ?? "Quality gate failed."] };
}
