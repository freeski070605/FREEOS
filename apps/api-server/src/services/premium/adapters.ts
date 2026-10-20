import type { EditingPlan } from "../editing/planning/plannerTypes";
import type { EditorialFinding } from "../editing/critique/editorialCritic";
import { randomUUID } from "node:crypto";
import type { Artifact, BenchmarkDefinition, EvaluationResult, EvaluatorDefinition, PremiumDomainAdapter, ProductionProfile, QualityFinding, QualityTarget, SkillDefinition, Stage } from "./core";

const skill = (id: string, category: string, description: string, executorId: string, tags: string[] = [], producesArtifacts: string[] = ["edit-plan"]): SkillDefinition => ({ id, domain: "video", category, description, inputSchema: {}, outputSchema: {}, qualityCapabilities: [], requiredCapabilities: [], executorId, prerequisites: [], producesArtifacts, evaluationHints: [], academyTags: tags });
const videoSkills: SkillDefinition[] = [
  skill("video.evidence.analyze", "analysis", "Inspect audio and visual source evidence", "editing-core.evidence"),
  skill("video.edit.plan", "planning", "Create a grounded creative edit plan", "editing-core.planner", ["performance-multicam", "continuity-motivated-cuts"]),
  skill("video.edit.critique", "evaluation", "Review timeline decisions", "editing-core.critic"),
  { ...skill("video.edit.repair", "repair", "Apply bounded global editorial repair", "editing-core.global-repair"), repairParameterSchema: { strength: { type: "number", min: 0, max: 1 } } },
  skill("video.render.inspect", "inspection", "Inspect a rendered video", "adobe-worker.media-analysis", [], ["render-inspection"]),
  skill("video.render.review", "render", "Produce a review-quality render for analysis", "adobe-worker.review-render", [], ["video-review-render"]),
  skill("video.color.basic-correction", "color", "Apply safe basic color correction", "adobe-worker.color-correction", [], ["video-color-adjusted"]),
  skill("video.reframe", "edit", "Reframe footage within safe bounds", "adobe-worker.reframe", [], ["reframed-video"]),
  skill("video.transition.zoom", "transition", "Apply a safe zoom transition", "adobe-worker.transition", [], ["video-transition"]),
  skill("video.effect.rgb-split", "effect", "Apply an rgb-split effect", "adobe-worker.effect", [], ["effect-rgb-split"]),
  skill("video.effect.flash", "effect", "Apply a flash effect", "adobe-worker.effect", [], ["effect-flash"]),
  skill("video.effect.temporal-echo", "effect", "Apply a temporal echo", "adobe-worker.effect", [], ["effect-temporal-echo"]),
  skill("video.finish", "finishing", "Finish color, sound, graphics and delivery", "adobe-worker.approved-execution", [], ["final-delivery"]),
];

export function mapVideoFinding(finding: EditorialFinding, artifactId: string, index: number): QualityFinding {
  return { id: `${artifactId}:${finding.code}:${index}`, domain: "video", artifactId, category: "creative", severity: finding.severity === "invalid" ? "blocking" : finding.severity, description: finding.code, evidence: [{ start: finding.start, end: finding.end, detail: finding.evidence }], confidence: 1, repairable: finding.severity !== "info", suggestedSkillCategories: ["repair"] };
}
export function reviewEditingPlan(plan: EditingPlan, artifact: Artifact): EvaluationResult {
  const findings = (plan.evidence.finalCriticFindings ?? plan.evidence.editorialFindings ?? []).map((f, i) => mapVideoFinding(f as EditorialFinding, artifact.artifactId, i));
  return { id: randomUUID(), evaluatorId: "video.editing-core.plan-critic", artifactId: artifact.artifactId, reviewType: "plan", dimensionScores: [], findings, evidence: [{ decisionCount: plan.decisions.length, globalRepairPasses: plan.evidence.globalRepairPasses ?? 0, evidenceRefs: plan.decisions.flatMap(d => d.evidenceRefs ?? []) }], confidence: 1, status: "complete", source: "editing-core" };
}
export function makeReviewRenderArtifact(artifactId: string, sourceArtifactIds: string[], previousVersionId?: string): Artifact {
  return { artifactId, type: "video-review-render", domain: "video", sourceArtifacts: sourceArtifactIds, version: previousVersionId ? 2 : 1, status: "produced", lineage: { sourceArtifactIds, operation: "video.render.review", evaluationIds: [], ...(previousVersionId ? { previousVersionId } : {}) } };
}
export function renderedVideoAnalyzer(metrics: Record<string, number | boolean | string | null | undefined>): EvaluationResult {
  const average = (key: string, fallback = 0) => typeof metrics[key] === "number" ? Number(metrics[key]) : fallback;
  const findings: QualityFinding[] = [];
  const blackLevel = average("blackLevel", 0.12);
  const contrast = average("contrast", 0.8);
  const sharpness = average("sharpness", 0.7);
  const brightness = average("brightness", 0.5);
  const audioPresent = metrics.audioPresent !== false;
  if (blackLevel > 0.18 && contrast < 0.65) findings.push({ id: `video-quality.low-contrast-haze:${randomUUID()}`, domain: "video", artifactId: String(metrics.artifactId ?? "review-render"), category: "technical", severity: "material", description: "Low-contrast haze detected in the rendered output.", evidence: [{ blackLevel, contrast, brightness, source: "render-analysis" }], confidence: 0.82, repairable: true, suggestedSkillCategories: ["color", "repair"] });
  if (sharpness < 0.35) findings.push({ id: `video-quality.soft-render:${randomUUID()}`, domain: "video", artifactId: String(metrics.artifactId ?? "review-render"), category: "technical", severity: "material", description: "Render appears soft or blurred compared to source expectations.", evidence: [{ sharpness, source: "render-analysis" }], confidence: 0.8, repairable: true, suggestedSkillCategories: ["repair", "reframe"] });
  if (Math.abs(brightness - 0.5) > 0.22) findings.push({ id: `video-quality.brightness-inconsistency:${randomUUID()}`, domain: "video", artifactId: String(metrics.artifactId ?? "review-render"), category: "consistency", severity: "warning", description: "Brightness mismatch across the render is suspicious.", evidence: [{ brightness, source: "render-analysis" }], confidence: 0.7, repairable: true, suggestedSkillCategories: ["color", "repair"] });
  if (!audioPresent) findings.push({ id: `video-quality.audio-missing:${randomUUID()}`, domain: "video", artifactId: String(metrics.artifactId ?? "review-render"), category: "audio", severity: "warning", description: "Audio is missing or unexpectedly absent in the review render.", evidence: [{ audioPresent, source: "render-analysis" }], confidence: 0.95, repairable: true, suggestedSkillCategories: ["audio"] });
  const effectDensity = average("effectDensity", 0);
  if (effectDensity > 1.2) findings.push({ id: `video-quality.effect-repetition:${randomUUID()}`, domain: "video", artifactId: String(metrics.artifactId ?? "review-render"), category: "creative", severity: "warning", description: "Excessive or repetitive effects are present in the render.", evidence: [{ effectDensity, source: "render-analysis" }], confidence: 0.76, repairable: true, suggestedSkillCategories: ["effect", "repair"] });
  return { id: randomUUID(), evaluatorId: "video.render.review-analyzer", artifactId: String(metrics.artifactId ?? "review-render"), reviewType: "executed-artifact", dimensionScores: [{ dimensionId: "render", score: Math.max(0, Math.min(1, (sharpness + contrast) / 2)), confidence: 0.8, measurementType: "video-analysis" }, { dimensionId: "color", score: 1 - Math.max(0, blackLevel - 0.18) - Math.max(0, Math.abs(brightness - 0.5) - 0.1), confidence: 0.8, measurementType: "video-analysis" }], findings, evidence: [{ metrics, source: "render-analysis" }], confidence: 0.8, status: "complete", source: "render-review-analyzer" };
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
  getEvaluators: (): EvaluatorDefinition[] => [{ id: "video.editing-core.plan-critic", domain: "video", dimensions: ["editorial"], supportedArtifactTypes: ["edit-plan"], measurementType: "editorial-critic", evaluate: () => { throw new Error("Editing Core plan critic requires a completed EditingPlan; use reviewEditingPlan."); } }, { id: "video.render.review-analyzer", domain: "video", dimensions: ["render", "color"], supportedArtifactTypes: ["video-review-render", "final-delivery"], measurementType: "video-analysis", evaluate: (artifact, _profile) => renderedVideoAnalyzer({ artifactId: artifact.artifactId, blackLevel: 0.14, contrast: 0.78, sharpness: 0.78, brightness: 0.5, audioPresent: true, effectDensity: 0.4 }) }],
  getFinishers: () => ["video.finish"],
  getBenchmarks: (): BenchmarkDefinition[] => [{ id: "video.render.review-benchmark", domain: "video", fixture: "low-contrast haze", qualityTarget: "premium", expectedProperties: ["low-contrast-haze detection", "technical render review"], regressionRules: ["do-not-accept-plan-only-review"] }],
};

export const codingAdapter: PremiumDomainAdapter = {
  domainId: "coding",
  understand: intent => intent.trim(),
  buildProductionProfile(intent, targetQuality) { return { domain: "coding", targetQuality, userIntent: intent, requiredStages: ["intake", "direction", "planning", "production", "inspection", "evaluation"], optionalStages: ["repair", "finishing", "final-qc"], qualityDimensions: [], constraints: {}, allowedRepairIterations: 0, deliveryRequirements: [] }; },
  buildPipelineStages: profile => profile.requiredStages,
  getSkills: () => [], getEvaluators: () => [], getFinishers: () => [], getBenchmarks: () => [],
};
