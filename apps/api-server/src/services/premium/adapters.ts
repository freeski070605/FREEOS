import type { EditingPlan } from "../editing/planning/plannerTypes";
import type { EditorialFinding } from "../editing/critique/editorialCritic";
import { randomUUID } from "node:crypto";
import type { Artifact, BenchmarkDefinition, EvaluationResult, EvaluatorDefinition, PremiumDomainAdapter, ProductionProfile, QualityFinding, QualityTarget, SkillDefinition, Stage } from "./core";

const skill = (id: string, category: string, description: string, executorId: string, tags: string[] = []): SkillDefinition => ({ id, domain: "video", category, description, inputSchema: {}, outputSchema: {}, qualityCapabilities: [], requiredCapabilities: [], executorId, prerequisites: [], producesArtifacts: ["edit-plan"], evaluationHints: [], academyTags: tags });
const videoSkills: SkillDefinition[] = [
  skill("video.evidence.analyze", "analysis", "Inspect audio and visual source evidence", "editing-core.evidence"),
  skill("video.edit.plan", "planning", "Create a grounded creative edit plan", "editing-core.planner", ["performance-multicam", "continuity-motivated-cuts"]),
  skill("video.edit.critique", "evaluation", "Review timeline decisions", "editing-core.critic"),
  { ...skill("video.edit.repair", "repair", "Apply bounded global editorial repair", "editing-core.global-repair"), repairParameterSchema: { strength: { type: "number", min: 0, max: 1 } } },
  skill("video.render.inspect", "inspection", "Inspect a rendered video", "adobe-worker.media-analysis"),
  skill("video.finish", "finishing", "Finish color, sound, graphics and delivery", "adobe-worker.approved-execution"),
];

export function mapVideoFinding(finding: EditorialFinding, artifactId: string, index: number): QualityFinding {
  return { id: `${artifactId}:${finding.code}:${index}`, domain: "video", artifactId, category: "creative", severity: finding.severity === "invalid" ? "blocking" : finding.severity, description: finding.code, evidence: [{ start: finding.start, end: finding.end, detail: finding.evidence }], confidence: 1, repairable: finding.severity !== "info", suggestedSkillCategories: ["repair"] };
}
export function reviewEditingPlan(plan: EditingPlan, artifact: Artifact): EvaluationResult {
  const findings = (plan.evidence.finalCriticFindings ?? plan.evidence.editorialFindings ?? []).map((f, i) => mapVideoFinding(f as EditorialFinding, artifact.artifactId, i));
  return { id: randomUUID(), evaluatorId: "video.editing-core.plan-critic", artifactId: artifact.artifactId, reviewType: "plan", dimensionScores: [], findings, evidence: [{ decisionCount: plan.decisions.length, globalRepairPasses: plan.evidence.globalRepairPasses ?? 0, evidenceRefs: plan.decisions.flatMap(d => d.evidenceRefs ?? []) }], confidence: 1, status: "complete", source: "editing-core" };
}

export const videoAdapter: PremiumDomainAdapter = {
  domainId: "video",
  understand: intent => intent.trim(),
  buildProductionProfile(intent: string, targetQuality: QualityTarget): ProductionProfile {
    const requiredStages: Stage[] = ["intake", "direction", "planning", "production", "inspection", "evaluation"];
    if (["professional", "premium", "maximum"].includes(targetQuality)) requiredStages.push("repair", "finishing", "final-qc");
    const domainStages = ["ingest", "media-analysis", "audio-understanding", "visual-understanding", "edit-planning", "edit-execution", "technical-correction", "render", "render-inspection", "final-delivery"];
    if (["professional", "premium", "maximum"].includes(targetQuality)) domainStages.splice(6, 0, "color", "sound", "finishing");
    if (/graphics|title|caption|visual effects|vfx|b-roll|broll/i.test(intent)) domainStages.splice(6, 0, "augmentation", "effects-graphics");
    return { domain: "video", targetQuality, userIntent: intent, requiredStages, optionalStages: ["repair", "finishing", "final-qc"].filter(s => !requiredStages.includes(s as Stage)) as Stage[], domainStages, qualityDimensions: [{ id: "editorial", description: "Grounded editorial quality", importance: 1, required: true }, { id: "render", description: "Final rendered video quality", importance: 1, required: requiredStages.includes("final-qc") }], constraints: {}, allowedRepairIterations: { draft: 0, standard: 1, professional: 2, premium: 3, maximum: 5 }[targetQuality], deliveryRequirements: ["final artifact reference", "lineage", "quality gate"] };
  },
  buildPipelineStages: profile => [...profile.requiredStages, "accepted", "delivered"],
  getSkills: () => videoSkills,
  getEvaluators: (): EvaluatorDefinition[] => [{ id: "video.editing-core.plan-critic", domain: "video", dimensions: ["editorial"], supportedArtifactTypes: ["edit-plan"], measurementType: "editorial-critic", evaluate: () => { throw new Error("Editing Core plan critic requires a completed EditingPlan; use reviewEditingPlan."); } }],
  getFinishers: () => ["video.finish"],
  getBenchmarks: (): BenchmarkDefinition[] => [],
};

export const codingAdapter: PremiumDomainAdapter = {
  domainId: "coding",
  understand: intent => intent.trim(),
  buildProductionProfile(intent, targetQuality) { return { domain: "coding", targetQuality, userIntent: intent, requiredStages: ["intake", "direction", "planning", "production", "inspection", "evaluation"], optionalStages: ["repair", "finishing", "final-qc"], qualityDimensions: [], constraints: {}, allowedRepairIterations: 0, deliveryRequirements: [] }; },
  buildPipelineStages: profile => profile.requiredStages,
  getSkills: () => [], getEvaluators: () => [], getFinishers: () => [], getBenchmarks: () => [],
};
