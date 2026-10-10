import { inspectOperatorEnvironment, type OperatorEnvironmentInventory, type OperatorKey } from "@freeos/operator-core";
import { searchSearxng, readPublicPage, type NormalizedSearchResult } from "@freeos/research-core";
import { getToolRegistry } from "@freeos/tool-runner";
import { config } from "../config";
import { generateWithOllama } from "./ollama.service";
import { buildSkillTeachingContext } from "./skillTeachingContext.service";

export type QualityTier = "draft" | "standard" | "production" | "premium";
export type QualityDecision = "proceed" | "capability_expansion_required";

export interface QualityResearchEvidence {
  query: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  contentPreview: string;
  read: boolean;
}

export interface QualityPreflightPlan {
  qualityTarget: {
    tier: QualityTier;
    definition: string;
    dimensions: Array<{ name: string; target: number; reason: string }>;
  };
  localCapabilities: Array<{ name: string; canUseNow: boolean; relevance: string; reason: string }>;
  workflow: Array<{ order: number; action: string; tool: string; reason: string; requiredCapability: string }>;
  gaps: Array<{ capability: string; severity: "low" | "medium" | "high" | "blocking"; why: string; resolution: "use-installed" | "learn-current-tool" | "acquire-free-tool" | "build-adapter" | "owner-decision" }>;
  acquisitionCandidates: Array<{ name: string; sourceUrl: string; freeStatus: "confirmed-free" | "likely-free" | "unknown"; licenseStatus: string; reason: string; confidence: "high" | "medium" | "low" }>;
  researchSummary: string;
  decision: QualityDecision;
  why: string;
}

export interface QualityPreflight {
  taskId: number;
  operatorKey: OperatorKey;
  projectKey: string | null;
  objective: string;
  qualityTier: QualityTier;
  inventory: OperatorEnvironmentInventory;
  skillItems: Array<{ competencyKey: string; title: string; masteryLevel: string; riskLevel: string }>;
  research: QualityResearchEvidence[];
  plan: QualityPreflightPlan;
  warnings: string[];
  createdAt: string;
}

const db = () => getToolRegistry().database;

function ensureSchema(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS quality_execution_preflights (
      task_id INTEGER PRIMARY KEY,
      operator_key TEXT NOT NULL,
      project_key TEXT,
      objective TEXT NOT NULL,
      quality_tier TEXT NOT NULL,
      inventory_json TEXT NOT NULL,
      skill_items_json TEXT NOT NULL,
      research_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_quality_execution_created ON quality_execution_preflights(created_at DESC);
  `);
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function array(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" && value.trim() ? value.trim() : fallback; }

export function inferQualityTier(objective: string): QualityTier {
  const value = objective.toLowerCase();
  if (/\b(rough|draft|sketch|prototype|proof of concept|poc|quick test|blockout only)\b/.test(value)) return "draft";
  if (/\b(premium|highest quality|best possible|production[- ]ready|professional|polished|hero asset|recurring ip|final quality)\b/.test(value)) return "premium";
  if (/\b(production|client|publish|release|deliverable|commercial|animation[- ]ready|game[- ]ready)\b/.test(value)) return "production";
  return "standard";
}

function fallbackPlan(objective: string, operatorKey: OperatorKey, tier: QualityTier, inventory: OperatorEnvironmentInventory, warnings: string[]): QualityPreflightPlan {
  const productionVerb = /\b(create|build|make|edit|render|animate|design|produce|finish|master|model|rig|develop)\b/i.test(objective);
  const characterWork = /\b(character|human|person|humanoid|face|rig|topology|clothing|hair)\b/i.test(objective);
  const selected = inventory.operator;
  const nativeEnough = operatorKey === "blender" ? selected.capabilities.includes("native-plan") && !(characterWork && tier !== "draft") : !productionVerb;
  const ready = selected.ready && (tier === "draft" || nativeEnough);
  const signals = inventory.blender?.capabilitySignals ?? [];
  const localCapabilities = [
    { name: selected.name, canUseNow: selected.ready, relevance: "primary", reason: selected.ready ? "Configured production operator." : "Operator executable is not configured or available." },
    ...signals.map(name => ({ name, canUseNow: true, relevance: "installed-addon", reason: "Detected during local environment inspection and should be evaluated before acquiring another tool." })),
  ];
  const gaps: QualityPreflightPlan["gaps"] = ready ? [] : [{
    capability: characterWork ? "production-quality character workflow" : "task-specific native production adapter",
    severity: "blocking",
    why: characterWork ? "The current Blender fixed-plan driver is a primitive scene builder and cannot honestly meet a production/premium character target by itself." : "The configured operator can be launched, but FREEOS does not yet have a task-specific native adapter that proves the requested deliverable can be produced autonomously.",
    resolution: signals.length ? "learn-current-tool" : "build-adapter",
  }];
  if (warnings.length) gaps.push({ capability: "current workflow research", severity: "medium", why: warnings.join(" "), resolution: "learn-current-tool" });
  return {
    qualityTarget: { tier, definition: `${tier} quality for the requested objective without treating file creation alone as success.`, dimensions: [
      { name: "technical correctness", target: tier === "premium" ? 9 : 8, reason: "Deliverable must function correctly." },
      { name: "professional polish", target: tier === "premium" ? 9 : 7, reason: "Output should match the requested quality level." },
      { name: "deliverable completeness", target: 9, reason: "Required outputs must be present and verified." },
    ] },
    localCapabilities,
    workflow: [{ order: 1, action: "Use the strongest verified local workflow and inspect the result before completion.", tool: selected.name, reason: "Prefer existing capabilities before acquisition.", requiredCapability: "verified production execution" }],
    gaps,
    acquisitionCandidates: [],
    researchSummary: warnings.length ? "Web research was incomplete; do not treat stale assumptions as current best practice." : "Quality preflight used available local and current research evidence.",
    decision: ready ? "proceed" : "capability_expansion_required",
    why: ready ? "The current operator is sufficient for the inferred quality target." : "The current execution capability does not honestly support the requested quality target yet.",
  };
}

function cleanPlan(raw: Record<string, any>, fallback: QualityPreflightPlan, evidenceUrls: Set<string>, tier: QualityTier): QualityPreflightPlan {
  const target = record(raw.qualityTarget);
  const dimensions = array(target.dimensions).slice(0, 12).map(item => ({
    name: text(record(item).name, "quality"),
    target: Math.min(10, Math.max(1, Number(record(item).target) || 8)),
    reason: text(record(item).reason, "Required for the requested deliverable."),
  }));
  const localCapabilities = array(raw.localCapabilities).slice(0, 30).map(item => ({
    name: text(record(item).name, "Unknown capability"),
    canUseNow: record(item).canUseNow === true,
    relevance: text(record(item).relevance, "supporting"),
    reason: text(record(item).reason),
  }));
  const workflow = array(raw.workflow).slice(0, 24).map((item, index) => ({
    order: Number(record(item).order) || index + 1,
    action: text(record(item).action, "Execute verified production step."),
    tool: text(record(item).tool, "FREEOS"),
    reason: text(record(item).reason),
    requiredCapability: text(record(item).requiredCapability),
  }));
  const allowedResolutions = new Set(["use-installed", "learn-current-tool", "acquire-free-tool", "build-adapter", "owner-decision"]);
  const allowedSeverity = new Set(["low", "medium", "high", "blocking"]);
  const modelGaps: QualityPreflightPlan["gaps"] = array(raw.gaps).slice(0, 24).map(item => {
    const value = record(item);
    const severity = text(value.severity, "medium");
    const resolution = text(value.resolution, "learn-current-tool");
    return {
      capability: text(value.capability, "Unspecified capability"),
      severity: (allowedSeverity.has(severity) ? severity : "medium") as "low" | "medium" | "high" | "blocking",
      why: text(value.why),
      resolution: (allowedResolutions.has(resolution) ? resolution : "learn-current-tool") as "use-installed" | "learn-current-tool" | "acquire-free-tool" | "build-adapter" | "owner-decision",
    };
  });
  const acquisitionCandidates = array(raw.acquisitionCandidates).slice(0, 12).map(item => {
    const value = record(item);
    const url = text(value.sourceUrl);
    const safeUrl = evidenceUrls.has(url) ? url : "";
    const freeStatus = text(value.freeStatus, "unknown");
    const confidence = text(value.confidence, "low");
    return {
      name: text(value.name, "Unnamed candidate"),
      sourceUrl: safeUrl,
      freeStatus: (["confirmed-free", "likely-free", "unknown"].includes(freeStatus) ? freeStatus : "unknown") as "confirmed-free" | "likely-free" | "unknown",
      licenseStatus: text(value.licenseStatus, "unverified"),
      reason: text(value.reason),
      confidence: (["high", "medium", "low"].includes(confidence) ? confidence : "low") as "high" | "medium" | "low",
    };
  }).filter(item => item.sourceUrl);
  const modelDecision = raw.decision === "proceed" || raw.decision === "capability_expansion_required" ? raw.decision as QualityDecision : fallback.decision;
  const hardCapabilityGap = fallback.decision === "capability_expansion_required" && fallback.gaps.some(item => item.severity === "blocking");
  const mergedGaps = hardCapabilityGap
    ? [...fallback.gaps, ...modelGaps.filter(item => !fallback.gaps.some(existing => existing.capability.toLowerCase() === item.capability.toLowerCase()))]
    : (modelGaps.length ? modelGaps : fallback.gaps);
  return {
    qualityTarget: {
      tier,
      definition: text(target.definition, fallback.qualityTarget.definition),
      dimensions: dimensions.length ? dimensions : fallback.qualityTarget.dimensions,
    },
    localCapabilities: localCapabilities.length ? localCapabilities : fallback.localCapabilities,
    workflow: workflow.length ? workflow : fallback.workflow,
    gaps: mergedGaps,
    acquisitionCandidates,
    researchSummary: text(raw.researchSummary, fallback.researchSummary),
    decision: hardCapabilityGap ? "capability_expansion_required" : modelDecision,
    why: hardCapabilityGap ? `${fallback.why} Research can improve the resolution plan, but it cannot claim an execution adapter exists when it does not.` : text(raw.why, fallback.why),
  };
}

function researchQueries(objective: string, inventory: OperatorEnvironmentInventory, tier: QualityTier): string[] {
  const compactObjective = objective.replace(/\s+/g, " ").slice(0, 260);
  const name = inventory.operator.name;
  const queries = [
    `${name} current ${tier} quality best practice workflow ${compactObjective}`,
    `${name} official documentation best workflow production quality ${compactObjective}`,
    `best free open source tools ${name} ${compactObjective} production workflow`,
  ];
  for (const signal of inventory.blender?.capabilitySignals ?? []) queries.push(`${signal} Blender official documentation production workflow`);
  return Array.from(new Set(queries)).slice(0, 5);
}

async function collectResearch(queries: string[], warnings: string[]): Promise<QualityResearchEvidence[]> {
  const evidence: QualityResearchEvidence[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    let results: NormalizedSearchResult[] = [];
    try { results = await searchSearxng(config.searxngBaseUrl, query, { maxResults: 5 }); }
    catch (error) { warnings.push(`Research search unavailable for '${query}': ${error instanceof Error ? error.message : "unknown error"}`); continue; }
    for (const result of results.slice(0, 4)) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      let contentPreview = "";
      let read = false;
      if (evidence.length < 8) {
        try {
          const page = await readPublicPage(result.url);
          contentPreview = page.contentPreview.slice(0, 5_000);
          read = true;
        } catch { /* Search snippet remains usable as current evidence. */ }
      }
      evidence.push({ query, title: result.title, url: result.url, domain: result.domain, snippet: result.snippet, contentPreview, read });
      if (evidence.length >= 12) return evidence;
    }
  }
  return evidence;
}

function persist(preflight: QualityPreflight): void {
  ensureSchema();
  db().prepare(`INSERT INTO quality_execution_preflights(task_id,operator_key,project_key,objective,quality_tier,inventory_json,skill_items_json,research_json,plan_json,warnings_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(task_id) DO UPDATE SET operator_key=excluded.operator_key,project_key=excluded.project_key,objective=excluded.objective,quality_tier=excluded.quality_tier,inventory_json=excluded.inventory_json,skill_items_json=excluded.skill_items_json,research_json=excluded.research_json,plan_json=excluded.plan_json,warnings_json=excluded.warnings_json,updated_at=CURRENT_TIMESTAMP`)
    .run(preflight.taskId, preflight.operatorKey, preflight.projectKey, preflight.objective, preflight.qualityTier, JSON.stringify(preflight.inventory), JSON.stringify(preflight.skillItems), JSON.stringify(preflight.research), JSON.stringify(preflight.plan), JSON.stringify(preflight.warnings));
}

function fromRow(value: any): QualityPreflight {
  return {
    taskId: Number(value.task_id), operatorKey: String(value.operator_key) as OperatorKey, projectKey: value.project_key ?? null,
    objective: String(value.objective), qualityTier: String(value.quality_tier) as QualityTier,
    inventory: JSON.parse(String(value.inventory_json)), skillItems: JSON.parse(String(value.skill_items_json)), research: JSON.parse(String(value.research_json)), plan: JSON.parse(String(value.plan_json)), warnings: JSON.parse(String(value.warnings_json ?? "[]")), createdAt: String(value.created_at),
  };
}

export function getQualityPreflight(taskId: number): QualityPreflight | null {
  ensureSchema();
  const value = db().prepare("SELECT * FROM quality_execution_preflights WHERE task_id=?").get(taskId);
  return value ? fromRow(value) : null;
}

export function listQualityPreflights(limit = 50): QualityPreflight[] {
  ensureSchema();
  const safe = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return (db().prepare("SELECT * FROM quality_execution_preflights ORDER BY updated_at DESC LIMIT ?").all(safe) as any[]).map(fromRow);
}

export async function runQualityPreflight(input: { taskId: number; operatorKey: OperatorKey; projectKey?: string | null; objective: string; force?: boolean }): Promise<QualityPreflight> {
  ensureSchema();
  if (!input.force) {
    const existing = getQualityPreflight(input.taskId);
    if (existing && existing.objective === input.objective && existing.operatorKey === input.operatorKey) return existing;
  }
  const warnings: string[] = [];
  const qualityTier = inferQualityTier(input.objective);
  const inventory = await inspectOperatorEnvironment(input.operatorKey);
  const skill = buildSkillTeachingContext({ query: `${inventory.operator.name} ${input.objective}`, limit: 14 });
  const skillItems = skill.items.map(item => ({ competencyKey: item.competencyKey, title: item.title, masteryLevel: item.masteryLevel, riskLevel: item.riskLevel }));
  const research = await collectResearch(researchQueries(input.objective, inventory, qualityTier), warnings);
  const fallback = fallbackPlan(input.objective, input.operatorKey, qualityTier, inventory, warnings);
  const evidenceUrls = new Set(research.map(item => item.url));
  let plan = fallback;
  try {
    const system = `You are FREEOS Quality-Seeking Execution Planner. Your job is not to merely make something; determine the strongest practical workflow for the requested quality target. Always inspect and prefer useful tools already installed on the computer before proposing new ones. If current knowledge is weak, use the supplied current web research. Treat Skill Academy material as procedural guidance, not proof of mastery. Do not recommend an inferior workflow just because it is already configured. If an installed tool could materially improve quality, include it. If FREEOS cannot actually operate a needed installed tool yet, identify a build-adapter gap instead of pretending it can. If a new tool is needed, prefer free/open-source or genuinely free options compatible with the current environment and only cite candidate source URLs that appear in supplied evidence. Never treat file creation alone as quality success. Return JSON only with: qualityTarget{tier,definition,dimensions[{name,target,reason}]}, localCapabilities[{name,canUseNow,relevance,reason}], workflow[{order,action,tool,reason,requiredCapability}], gaps[{capability,severity,why,resolution}], acquisitionCandidates[{name,sourceUrl,freeStatus,licenseStatus,reason,confidence}], researchSummary, decision(proceed|capability_expansion_required), why.`;
    const prompt = JSON.stringify({ objective: input.objective, qualityTier, operatorInventory: inventory, skillContext: skill.context.slice(0, 14_000), researchEvidence: research }, null, 2);
    const raw = await generateWithOllama({ model: config.defaultModel, system, prompt, timeoutMs: config.ollamaGenerateTimeoutMs, options: { temperature: 0.25, top_p: 0.85, repeat_penalty: 1.08, num_predict: 3200 } });
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("Quality planner did not return JSON.");
    plan = cleanPlan(JSON.parse(raw.slice(first, last + 1)), fallback, evidenceUrls, qualityTier);
  } catch (error) {
    warnings.push(`Quality planner fallback used: ${error instanceof Error ? error.message : "unknown model error"}`);
  }
  const preflight: QualityPreflight = { taskId: input.taskId, operatorKey: input.operatorKey, projectKey: input.projectKey ?? null, objective: input.objective, qualityTier, inventory, skillItems, research, plan, warnings, createdAt: new Date().toISOString() };
  persist(preflight);
  return preflight;
}
