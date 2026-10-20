import path from "node:path";
import { ToolRequests, getToolRegistry } from "@freeos/tool-runner";
import { createProposal } from "@freeos/memory-core";
import { adobeService } from "../adobe.service";
import { addArtifact, currentEvaluations, qualityGate, recordRepair, validateRepairPlan, type PipelineLearningCandidate, type PremiumPipelineRun, type QualityGateResult, type RepairPlan } from "./core";
import { compareRenderPixels, effectDensityReview, evaluateRenderQuality, type RenderAudio, type RenderPixels, type RenderProbe } from "./renderQuality";
import { getRun, premiumRegistry, saveRun } from "./service";

export interface ReviewRenderSpec { projectPath: string; sequenceId: string; presetPath: string; outputPath: string; planArtifactId: string; sourcePath?: string; audioExpected?: boolean }
const requests = () => new ToolRequests(getToolRegistry());
function capability(audioExpected = false): void {
  const status = adobeService.status();
  if (!status.online || !status.capabilities.some(c => c.application === "premiere" && c.action === "sequence.render" && c.available) || !status.capabilities.some(c => c.application === "media" && c.action === "media.probe" && c.available) || !status.capabilities.some(c => c.application === "media" && c.action === "media.quality.analyze" && c.available) || audioExpected && !status.capabilities.some(c => c.application === "media" && c.action === "media.audio.analyze" && c.available)) throw new Error("Adobe render, ffprobe, pixel analyzer, or required audio analyzer capability is unavailable.");
}
export function premiumVideoGate(run: PremiumPipelineRun): QualityGateResult {
  const gate = qualityGate(run.productionProfile, currentEvaluations(run.evaluations));
  const latest = run.artifacts.filter(a => a.type === "video-review-render").at(-1);
  const review = latest && [...run.evaluations].reverse().find(e => e.artifactId === latest.artifactId && e.evaluatorId === "video.render.review-analyzer" && e.source === "real-render-quality");
  const reasons = [...gate.reasons];
  if (run.videoIteration && !["analyzing-review", "accepted"].includes(run.videoIteration.stage)) reasons.push("Current review iteration is unfinished or failed.");
  if (run.videoIteration?.artifactId && latest?.artifactId !== run.videoIteration.artifactId) reasons.push("Current review artifact does not match the iteration.");
  if (!latest?.reference || !latest.metadata?.probe || !review) reasons.push("Actual rendered review artifact and analysis required.");
  if (review && !review.dimensionScores.some(s => s.dimensionId === "artifact-integrity" && s.score === 1)) reasons.push("Rendered artifact integrity check required.");
  if (run.videoIteration?.parameters?.audioExpected === "true" && !review?.dimensionScores.some(s => s.dimensionId === "audio-quality" && s.score === 1)) reasons.push("Rendered audio analysis required.");
  if (latest?.metadata?.audioPresent === true && !review?.dimensionScores.some(s => s.dimensionId === "audio-quality" && s.score === 1)) reasons.push("Present rendered audio must be analyzed.");
  if (run.productionProfile.requiredStages.includes("final-qc") && !run.evaluations.some(e => e.reviewType === "plan" && e.dimensionScores.some(s => s.dimensionId === "editorial"))) reasons.push("Editing Core editorial review required.");
  return reasons.length ? { outcome: "FAIL", reasons } : gate;
}
export function buildPipelineLearningCandidate(run: PremiumPipelineRun): PipelineLearningCandidate {
  return { domain: run.domain, qualityTarget: run.targetQuality, successfulSkills: [...new Set(run.skillsUsed)], failedSkills: run.failure ? run.pendingRepairPlan?.repairs.map(r => r.skillId) ?? [] : [], capabilityPerformance: run.telemetry.capabilityHealth, repairsThatImprovedQuality: run.videoIteration?.comparison?.resolvedFindings ?? run.telemetry.resolvedFindings, repairsThatRegressedQuality: run.videoIteration?.comparison?.introducedFindings ?? run.telemetry.qualityRegressions ?? [], finalOutcome: run.status };
}
export function requestPremiumVideoReview(runId: string, spec: ReviewRenderSpec): PremiumPipelineRun {
  const run = getRun(runId);
  if (!run || run.domain !== "video" || !run.productionPlan) throw new Error("A planned premium video run is required.");
  if (run.videoIteration && !["quality-failed", "rejected"].includes(run.videoIteration.stage)) throw new Error("Review iteration is already active.");
  if (run.videoIteration?.stage === "quality-failed" && run.videoRepair?.stage !== "executed") throw new Error("A failed review requires an executed approved repair before re-rendering.");
  if (run.repairs.length >= run.productionProfile.allowedRepairIterations && run.videoIteration?.stage === "quality-failed") throw new Error("Repair iteration limit reached.");
  if (run.pendingRepairPlan && run.videoRepair?.stage !== "executed") throw new Error("Approved repair must finish before a new review version.");
  if (!run.artifacts.some(a => a.artifactId === spec.planArtifactId && a.type === "edit-plan")) throw new Error("Known edit-plan artifact required.");
  if (spec.sourcePath && !run.artifacts.some(a => a.type === "video" && a.reference === spec.sourcePath)) throw new Error("Source comparison path must match a registered video source artifact.");
  if (![spec.projectPath, spec.sequenceId, spec.presetPath, spec.outputPath].every(v => typeof v === "string" && !!v.trim())) throw new Error("Explicit project, sequence, preset, and output paths required.");
  const version = run.artifacts.filter(a => a.type === "video-review-render").length + 1;
  if (path.basename(spec.outputPath).toLowerCase() !== `review-v${version}.mp4`) throw new Error(`Output filename must be review-v${version}.mp4.`);
  capability(!!spec.audioExpected);
  const request = requests().createToolRequest({ toolKey: "premium.video.review-render", title: `Render review v${version} for run ${run.runId}`, description: "Approve this exact Premiere project, sequence, preset, and output path.", args: { ...spec, runId }, requestedBy: "premium-video-pipeline" });
  run.videoIteration = { stage: "awaiting-execution-approval", approvalId: request.id, planArtifactId: spec.planArtifactId, parameters: { projectPath: spec.projectPath, sequenceId: spec.sequenceId, presetPath: spec.presetPath, outputPath: spec.outputPath, ...(spec.sourcePath ? { sourcePath: spec.sourcePath } : {}), audioExpected: String(!!spec.audioExpected) } };
  run.status = "active"; run.currentStage = "production"; saveRun(run); return run;
}

export async function requestEffectRemoval(runId: string, findingId: string, target: { trackIndex: number; clipStart: number; clipEnd: number; componentMatchName: string }): Promise<PremiumPipelineRun> {
  const run = getRun(runId);
  if (!run || run.videoIteration?.stage !== "quality-failed" || run.videoRepair || run.repairs.length >= run.productionProfile.allowedRepairIterations) throw new Error("A failed rendered review with repair capacity is required.");
  const review = run.artifacts.filter(a => a.type === "video-review-render").at(-1)!;
  const finding = [...run.evaluations].reverse().find(e => e.artifactId === review.artifactId)?.findings.find(f => f.id === findingId && f.repairable);
  if (!finding || !review.lineage.projectPath || !review.lineage.sequenceId) throw new Error("A repairable rendered finding and explicit project/sequence are required.");
  if (!Number.isInteger(target.trackIndex) || target.trackIndex < 0 || target.trackIndex > 63 || !Number.isFinite(target.clipStart) || !Number.isFinite(target.clipEnd) || target.clipStart < 0 || target.clipEnd <= target.clipStart || target.clipEnd > 7200 || typeof target.componentMatchName !== "string" || !target.componentMatchName || target.componentMatchName.length > 200) throw new Error("Effect target parameters are outside safe bounds.");
  capability();
  const inspected = await adobeService.run("premiere", "sequence.effects.inspect", { projectPath: review.lineage.projectPath, sequenceId: review.lineage.sequenceId, trackIndex: target.trackIndex, clipStart: target.clipStart, clipEnd: target.clipEnd }) as { components?: Array<{ matchName: string }> };
  if (inspected.components?.filter(c => c.matchName === target.componentMatchName).length !== 1) throw new Error("Requested effect is not a uniquely inspected component of the clip.");
  const plan: RepairPlan = { repairs: [{ id: `repair-${run.repairs.length + 1}`, findingIds: [findingId], skillId: "video.effect.remove", capabilityId: "adobe-worker.review-render", inputArtifactIds: [review.artifactId], parameters: target, expectedQualityEffect: `Remove inspected ${target.componentMatchName} effect and re-render for measurement.` }] };
  validateRepairPlan(plan, [finding], run, premiumRegistry);
  const args = { runId, findingId, artifactId: review.artifactId, projectPath: review.lineage.projectPath, sequenceId: review.lineage.sequenceId, ...target };
  const approval = requests().createToolRequest({ toolKey: "premium.video.effect-remove", title: `Remove inspected effect for run ${runId}`, description: `Finding ${findingId}; remove ${target.componentMatchName} from clip ${target.clipStart}-${target.clipEnd} on track ${target.trackIndex}.`, args, requestedBy: "premium-video-pipeline" });
  run.pendingRepairPlan = plan; run.videoRepair = { stage: "awaiting-approval", approvalId: approval.id, findingId, artifactId: review.artifactId, parameters: target }; run.currentStage = "repair"; saveRun(run); return run;
}

export function runEffectRemoval(runId: string): { run: PremiumPipelineRun; nextAction: string } {
  const run = getRun(runId);
  if (!run || !run.videoRepair || !run.pendingRepairPlan) throw new Error("Pending video repair not found.");
  const repair = run.videoRepair;
  if (repair.stage === "awaiting-approval") {
    const approval = requests().get(repair.approvalId!);
    if (approval.status === "pending") return { run, nextAction: "approve-tool-request" };
    if (approval.status !== "approved") { repair.stage = "failed"; repair.error = `Repair approval ${approval.status}.`; run.status = "rejected"; run.currentStage = "rejected"; run.failure = { code: "validation-failure", detail: repair.error }; saveRun(run); return { run, nextAction: "failed" }; }
    const artifact = run.artifacts.find(a => a.artifactId === repair.artifactId)!;
    if (approval.toolKey !== "premium.video.effect-remove" || approval.args.runId !== runId || approval.args.findingId !== repair.findingId || approval.args.artifactId !== repair.artifactId || approval.args.projectPath !== artifact.lineage.projectPath || approval.args.sequenceId !== artifact.lineage.sequenceId || Object.entries(repair.parameters).some(([key, value]) => approval.args[key] !== value)) throw new Error("Approved repair no longer matches the inspected effect.");
    capability();
    const toolRun = requests().startRun("premium.video.effect-remove", approval.args, approval.id);
    try { repair.jobId = adobeService.submit("premiere", "sequence.effect.remove", { projectPath: artifact.lineage.projectPath, sequenceId: artifact.lineage.sequenceId, ...repair.parameters }); repair.toolRunId = toolRun.id; repair.stage = "executing"; saveRun(run); }
    catch (error) { requests().finishRun(toolRun.id, "failed", null, String(error)); repair.stage = "failed"; repair.error = String(error); saveRun(run); }
    return { run, nextAction: repair.stage === "failed" ? "failed" : "poll-repair" };
  }
  if (repair.stage === "executing") {
    const job = adobeService.job(repair.jobId!);
    if (!job || ["queued", "running", "waiting"].includes(job.state)) return { run, nextAction: "poll-repair" };
    if (job.state !== "complete") { requests().finishRun(repair.toolRunId!, "failed", null, job.error || "Effect removal failed."); repair.stage = "failed"; repair.error = job.error || "Effect removal failed."; run.status = "rejected"; run.currentStage = "rejected"; run.failure = { code: "execution-failure", detail: repair.error }; saveRun(run); return { run, nextAction: "failed" }; }
    const output = job.output as { componentMatchName?: string; saved?: boolean };
    if (output.componentMatchName !== repair.parameters.componentMatchName || output.saved !== true) throw new Error("Adobe did not confirm the approved repair and project save.");
    repair.executionId = job.jobId; repair.stage = "executed"; run.skillsUsed.push("video.effect.remove"); run.capabilitiesUsed.push("adobe-worker.review-render"); requests().finishRun(repair.toolRunId!, "completed", output, null); saveRun(run);
    return { run, nextAction: "request-review-render" };
  }
  return { run, nextAction: repair.stage === "executed" ? "request-review-render" : "failed" };
}
export async function runPremiumVideoIteration(runId: string): Promise<{ run: PremiumPipelineRun; nextAction: string; gate?: QualityGateResult }> {
  const run = getRun(runId);
  if (!run || run.domain !== "video") throw new Error("Video run not found.");
  const state = run.videoIteration;
  if (!state) return { run, nextAction: "request-review-render" };
  if (state.stage === "awaiting-execution-approval") {
    const approval = requests().get(state.approvalId!);
    if (approval.status === "pending") return { run, nextAction: "approve-tool-request" };
    if (approval.status !== "approved") { state.stage = "rejected"; state.error = `Review approval ${approval.status}.`; saveRun(run); return { run, nextAction: "rejected" }; }
    if (approval.toolKey !== "premium.video.review-render" || approval.args.runId !== runId || Object.entries(state.parameters!).some(([key, value]) => key !== "audioExpected" && approval.args[key] !== value)) throw new Error("Approved render request no longer matches the run.");
    capability(state.parameters!.audioExpected === "true");
    const toolRun = requests().startRun("premium.video.review-render", approval.args, approval.id);
    try {
      const jobId = adobeService.submit("premiere", "sequence.render", { projectPath: state.parameters!.projectPath, sequenceId: state.parameters!.sequenceId, presetPath: state.parameters!.presetPath, outputPath: state.parameters!.outputPath });
      state.toolRunId = toolRun.id; state.jobId = jobId; state.startedAt = new Date().toISOString(); state.stage = "rendering-review"; run.currentStage = "production"; saveRun(run);
    } catch (error) { requests().finishRun(toolRun.id, "failed", null, String(error)); state.stage = "rejected"; state.error = String(error); saveRun(run); }
    return { run, nextAction: state.stage === "rejected" ? "rejected" : "poll-render" };
  }
  if (state.stage === "rendering-review") {
    const job = adobeService.job(state.jobId!);
    if (!job || ["queued", "running", "waiting"].includes(job.state)) return { run, nextAction: "poll-render" };
    if (job.state !== "complete") { requests().finishRun(state.toolRunId!, "failed", null, job.error || "Render failed."); state.stage = "rejected"; state.error = job.error || "Render failed."; run.telemetry.capabilityHealth = { ...run.telemetry.capabilityHealth, adobe: { available: false, lastFailure: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(state.startedAt!) } }; saveRun(run); return { run, nextAction: "rejected" }; }
    const output = job.output as { path?: string; probe?: unknown; filesize?: number; createdAt?: string; probeElapsedMs?: number };
    if (typeof output?.path !== "string" || path.resolve(output.path).toLowerCase() !== path.resolve(state.parameters!.outputPath).toLowerCase() || !output.filesize || !output.probe) throw new Error("Worker returned an unverified render.");
    const previous = run.artifacts.filter(a => a.type === "video-review-render").at(-1);
    const sourceArtifactIds = [...new Set([state.planArtifactId!, ...(previous ? [previous.artifactId] : [])])];
    const effectExecution = run.videoRepair?.stage === "executed" ? { skillId: "video.effect.remove", executionId: run.videoRepair.executionId, timelineStart: run.videoRepair.parameters.clipStart, timelineEnd: run.videoRepair.parameters.clipEnd, parameters: run.videoRepair.parameters, artifactVersion: previous ? previous.version + 1 : 1 } : undefined;
    const artifact = { artifactId: job.jobId, type: "video-review-render", domain: "video", reference: output.path, mimeType: "video/mp4", metadata: { path: output.path, filesize: output.filesize, createdAt: output.createdAt, probe: output.probe, ...(effectExecution ? { effectExecutions: [effectExecution] } : {}) }, sourceArtifacts: sourceArtifactIds, version: previous ? previous.version + 1 : 1, status: "produced" as const, lineage: { sourceArtifactIds, operation: "video.render.review", skillId: "video.render.review", capabilityId: "adobe-worker.review-render", evaluationIds: [], runId, projectPath: state.parameters!.projectPath, sequenceId: state.parameters!.sequenceId, planArtifactId: state.planArtifactId, executionIds: [job.jobId, ...(effectExecution?.executionId ? [effectExecution.executionId] : [])], ...(previous ? { previousVersionId: previous.artifactId } : {}) } };
    addArtifact(run, artifact); state.artifactId = artifact.artifactId;
    run.telemetry.realRenderExecutions = (run.telemetry.realRenderExecutions ?? 0) + 1;
    run.telemetry.renderProbeElapsedMs = output.probeElapsedMs;
    run.telemetry.reviewRenderVersions = artifact.version;
    run.telemetry.effectLineageCount = (run.telemetry.effectLineageCount ?? 0) + (effectExecution ? 1 : 0);
    run.telemetry.capabilityHealth = { ...run.telemetry.capabilityHealth, adobe: { available: true, lastSuccess: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(state.startedAt!) } };
    requests().finishRun(state.toolRunId!, "completed", { artifactId: artifact.artifactId, path: output.path }, null);
    state.stage = "analyzing-review"; run.currentStage = "inspection"; saveRun(run);
    return runPremiumVideoIteration(runId);
  }
  if (state.stage === "analyzing-review") {
    if (!state.analysisJobId) {
      try { state.analysisJobId = adobeService.submit("media", "media.quality.analyze", { path: run.artifacts.find(a => a.artifactId === state.artifactId)!.reference, sampleFps: 1, audioExpected: state.parameters!.audioExpected === "true", ...(state.parameters!.sourcePath ? { sourcePath: state.parameters!.sourcePath } : {}) }); state.analysisStartedAt = new Date().toISOString(); state.error = undefined; saveRun(run); return { run, nextAction: "poll-analysis" }; }
      catch (error) { state.error = String(error); saveRun(run); return { run, nextAction: "retry-analysis" }; }
    }
    const job = adobeService.job(state.analysisJobId!);
    if (!job || ["queued", "running", "waiting"].includes(job.state)) return { run, nextAction: "poll-analysis" };
    if (job.state !== "complete") { state.stage = "rejected"; state.error = job.error || "Pixel analysis failed."; run.telemetry.capabilityHealth = { ...run.telemetry.capabilityHealth, analyzer: { available: false, lastFailure: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(state.analysisStartedAt!) } }; saveRun(run); return { run, nextAction: "rejected" }; }
    const artifact = run.artifacts.find(a => a.artifactId === state.artifactId)!;
    const raw = artifact.metadata!.probe as { format?: { duration?: string; bit_rate?: string }; streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; pix_fmt?: string; sample_rate?: string; channels?: number }> };
    const video = raw.streams?.find(s => s.codec_type === "video"), audio = raw.streams?.find(s => s.codec_type === "audio");
    const fpsParts = (video?.avg_frame_rate || "0/1").split("/").map(Number);
    const probe: RenderProbe = { path: artifact.reference!, duration: Number(raw.format?.duration || 0), width: video?.width || 0, height: video?.height || 0, fps: fpsParts[1] ? fpsParts[0] / fpsParts[1] : 0, codec: video?.codec_name || "unknown", bitrate: Number(raw.format?.bit_rate || 0), pixelFormat: video?.pix_fmt, filesize: Number(artifact.metadata!.filesize), audioPresent: !!audio, audioCodec: audio?.codec_name, sampleRate: audio ? Number(audio.sample_rate || 0) : undefined, channels: audio?.channels, createdAt: String(artifact.metadata!.createdAt) };
    const analyzed = job.output as { pixels: RenderPixels; sourcePixels?: RenderPixels; audio?: RenderAudio };
    const pixels = analyzed.pixels;
    const evaluation = evaluateRenderQuality(artifact, probe, pixels, { audioExpected: state.parameters!.audioExpected === "true", audio: analyzed.audio, source: analyzed.sourcePixels });
    const density = effectDensityReview(artifact, probe.duration, run.userIntent);
    evaluation.evidence.push({ effectDensity: density.metrics }); evaluation.findings.push(...density.findings);
    const effectExecution = (artifact.metadata?.effectExecutions as Array<{ timelineStart: number; timelineEnd: number }> | undefined)?.[0];
    const planArtifact = run.artifacts.find(a => a.artifactId === state.planArtifactId);
    const decisions = (planArtifact?.metadata?.decisions ?? []) as Array<{ start: number; end: number; clipId: string; action: string }>;
    for (const finding of evaluation.findings) {
      const evidence = finding.evidence[0] as { intervals?: Array<[number, number]>; times?: number[] } | undefined;
      const times = evidence?.times ?? evidence?.intervals?.map(interval => interval[0]) ?? [];
      const related = decisions.filter(d => times.some(t => t >= d.start && t < d.end));
      if (related.length) finding.evidence.push({ timelineDecisions: related });
      if (effectExecution && times.some(t => t >= Number(effectExecution.timelineStart) && t < Number(effectExecution.timelineEnd))) finding.evidence.push({ effectExecution });
    }
    const prior = run.artifacts.find(a => a.artifactId === artifact.lineage.previousVersionId);
    if (prior?.metadata?.pixels) {
      const priorEvaluation = [...run.evaluations].reverse().find(e => e.artifactId === prior.artifactId && e.evaluatorId === "video.render.review-analyzer");
      const beforeCodes = new Set(priorEvaluation?.findings.map(f => f.description) ?? []), afterCodes = new Set(evaluation.findings.map(f => f.description));
      state.comparison = { resolvedFindings: [...beforeCodes].filter(code => !afterCodes.has(code)), remainingFindings: [...beforeCodes].filter(code => afterCodes.has(code)), introducedFindings: [...afterCodes].filter(code => !beforeCodes.has(code)), measurementDeltas: compareRenderPixels(prior.metadata.pixels as RenderPixels, pixels) };
      run.telemetry.repairMeasurementDeltas = state.comparison.measurementDeltas;
      run.telemetry.qualityRegressions = state.comparison.introducedFindings;
      run.telemetry.resolvedFindings.push(...state.comparison.resolvedFindings);
      run.telemetry.introducedFindings.push(...state.comparison.introducedFindings);
    }
    run.evaluations.push(evaluation); artifact.lineage.evaluationIds.push(evaluation.id); artifact.metadata = { ...artifact.metadata, probe, pixels, duration: probe.duration, resolution: { width: probe.width, height: probe.height }, fps: probe.fps, codec: probe.codec, bitrate: probe.bitrate, pixelFormat: probe.pixelFormat, audioPresent: probe.audioPresent, audioCodec: probe.audioCodec, sampleRate: probe.sampleRate, channels: probe.channels };
    run.telemetry.pixelAnalysisElapsedMs = Date.now() - Date.parse(state.analysisStartedAt!);
    run.telemetry.sourceRenderComparisons = (run.telemetry.sourceRenderComparisons ?? 0) + (analyzed.sourcePixels && Math.abs(analyzed.sourcePixels.duration - pixels.duration) <= Math.max(1, pixels.duration * .1) ? 1 : 0);
    run.telemetry.capabilityHealth = { ...run.telemetry.capabilityHealth, analyzer: { available: true, lastSuccess: new Date().toISOString(), elapsedMs: run.telemetry.pixelAnalysisElapsedMs } };
    if (run.pendingRepairPlan && run.videoRepair?.stage === "executed" && prior) {
      const priorEvaluation = run.evaluations.find(e => e.artifactId === prior.artifactId && e.evaluatorId === "video.render.review-analyzer");
      if (priorEvaluation) { recordRepair(run, run.pendingRepairPlan, [priorEvaluation], [evaluation]); run.pendingRepairPlan = undefined; run.videoRepair = undefined; }
    }
    run.telemetry.evaluationCount++; run.telemetry.findingsAfter = evaluation.findings.map(f => f.id);
    const gate = premiumVideoGate(run); run.telemetry.qualityGateOutcome = gate.outcome;
    const exhausted = gate.outcome === "FAIL" && run.repairs.length >= run.productionProfile.allowedRepairIterations;
    state.stage = exhausted ? "rejected" : gate.outcome === "FAIL" ? "quality-failed" : "accepted";
    run.currentStage = exhausted ? "rejected" : gate.outcome === "FAIL" ? "evaluation" : "accepted";
    run.status = exhausted ? "rejected" : gate.outcome === "FAIL" ? "active" : "accepted";
    if (exhausted) run.failure = { code: "quality-failure", detail: `Review quality failed after ${run.repairs.length} approved repair iterations: ${gate.reasons.join("; ")}` };
    saveRun(run);
    return { run, nextAction: exhausted ? "rejected" : gate.outcome === "FAIL" ? "request-approved-repair" : "request-final-delivery", gate };
  }
  return { run, nextAction: state.stage === "accepted" ? "request-final-delivery" : state.stage === "quality-failed" ? "request-approved-repair" : "rejected", gate: premiumVideoGate(run) };
}

export function requestFinalVideoRender(runId: string, outputPath: string, presetPath: string): PremiumPipelineRun {
  const run = getRun(runId);
  if (!run || run.domain !== "video" || run.status !== "accepted" || premiumVideoGate(run).outcome !== "PASS") throw new Error("Final render requires a passing real review gate.");
  if (run.finalDelivery) throw new Error("Final delivery has already been requested.");
  const review = run.artifacts.filter(a => a.type === "video-review-render").at(-1)!;
  if (!outputPath || !presetPath || path.resolve(outputPath).toLowerCase() === path.resolve(review.reference!).toLowerCase() || path.extname(outputPath).toLowerCase() !== ".mp4") throw new Error("A separate .mp4 delivery output and preset are required.");
  const args = { runId, projectPath: review.lineage.projectPath!, sequenceId: review.lineage.sequenceId!, outputPath, presetPath };
  const approval = requests().createToolRequest({ toolKey: "premium.video.final-render", title: `Final delivery render for run ${runId}`, description: "Approve this exact accepted Premiere sequence, delivery preset, and output path.", args, requestedBy: "premium-video-pipeline" });
  run.finalDelivery = { stage: "awaiting-approval", approvalId: approval.id, outputPath, presetPath }; saveRun(run); return run;
}
export function runFinalVideoRender(runId: string): { run: PremiumPipelineRun; nextAction: string } {
  const run = getRun(runId);
  if (!run || !run.finalDelivery) throw new Error("Final delivery request not found.");
  const final = run.finalDelivery;
  if (final.stage === "awaiting-approval") {
    if (premiumVideoGate(run).outcome !== "PASS") throw new Error("Review gate no longer passes.");
    const approval = requests().get(final.approvalId!);
    if (approval.status === "pending") return { run, nextAction: "approve-tool-request" };
    if (approval.status !== "approved") { final.stage = "failed"; final.error = `Final approval ${approval.status}.`; saveRun(run); return { run, nextAction: "failed" }; }
    const review = run.artifacts.filter(a => a.type === "video-review-render").at(-1)!;
    if (approval.toolKey !== "premium.video.final-render" || approval.args.runId !== runId || approval.args.outputPath !== final.outputPath || approval.args.presetPath !== final.presetPath || approval.args.projectPath !== review.lineage.projectPath || approval.args.sequenceId !== review.lineage.sequenceId) throw new Error("Approved final render request no longer matches the accepted review.");
    capability();
    const toolRun = requests().startRun("premium.video.final-render", approval.args, approval.id);
    try { final.jobId = adobeService.submit("premiere", "sequence.render", { projectPath: review.lineage.projectPath, sequenceId: review.lineage.sequenceId, outputPath: final.outputPath, presetPath: final.presetPath }); final.toolRunId = toolRun.id; final.stage = "rendering"; run.currentStage = "finishing"; saveRun(run); }
    catch (error) { requests().finishRun(toolRun.id, "failed", null, String(error)); final.stage = "failed"; final.error = String(error); saveRun(run); }
    return { run, nextAction: final.stage === "failed" ? "failed" : "poll-final-render" };
  }
  if (final.stage === "rendering") {
    const job = adobeService.job(final.jobId!);
    if (!job || ["queued", "running", "waiting"].includes(job.state)) return { run, nextAction: "poll-final-render" };
    if (job.state !== "complete") { requests().finishRun(final.toolRunId!, "failed", null, job.error || "Final render failed."); final.stage = "failed"; final.error = job.error || "Final render failed."; saveRun(run); return { run, nextAction: "failed" }; }
    const output = job.output as { path?: string; probe?: unknown; filesize?: number; createdAt?: string };
    if (!output?.path || path.resolve(output.path).toLowerCase() !== path.resolve(final.outputPath).toLowerCase() || !output.filesize || !output.probe) throw new Error("Final render was not verified by the Adobe worker.");
    const review = run.artifacts.filter(a => a.type === "video-review-render").at(-1)!;
    const artifact = { artifactId: job.jobId, type: "final-delivery", domain: "video", reference: output.path, mimeType: "video/mp4", metadata: { path: output.path, filesize: output.filesize, createdAt: output.createdAt, probe: output.probe }, sourceArtifacts: [review.artifactId], version: 1, status: "produced" as const, lineage: { sourceArtifactIds: [review.artifactId], operation: "video.render.final", skillId: "video.render.final", capabilityId: "adobe-worker.review-render", evaluationIds: [], runId, projectPath: review.lineage.projectPath, sequenceId: review.lineage.sequenceId, executionIds: [job.jobId] } };
    addArtifact(run, artifact); final.artifactId = artifact.artifactId; final.stage = "delivered"; run.currentStage = "delivered"; run.status = "delivered"; run.telemetry.finalDeliveryProduced = true;
    run.learningCandidate = buildPipelineLearningCandidate(run);
    try { run.learningProposalId = createProposal({ title: `Premium video pipeline learning candidate ${run.runId}`, content: JSON.stringify(run.learningCandidate), category: "project", source: `premium-video:${run.runId}`, tags: ["premium-video", "pipeline-learning"], reason: "Review candidate evidence before approving durable learning." }).id; }
    catch (error) { run.learningGovernanceError = String(error); }
    requests().finishRun(final.toolRunId!, "completed", { artifactId: artifact.artifactId, path: output.path }, null); saveRun(run);
    return { run, nextAction: "delivered" };
  }
  return { run, nextAction: final.stage };
}
