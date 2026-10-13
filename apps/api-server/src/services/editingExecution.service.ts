export interface DryRunDecision {
  start: number;
  end: number;
  clipId: string;
  action: "cut" | "hold" | "punch-in";
  confidence?: number;
  rationale?: string;
}

export interface EditingDryRunRequest {
  project?: string;
  sequence?: string;
  durationSeconds?: number;
  decisions: DryRunDecision[];
}

export interface EditingDryRunOperation {
  index: number;
  kind: "activate-source" | "hold-source" | "punch-in";
  clipId: string;
  timelineStart: number;
  timelineEnd: number;
  duration: number;
  destructive: false;
  note: string;
}

export interface EditingDryRun {
  version: "freeos-premiere-dry-run-v1";
  mode: "preview-only";
  project?: string;
  sequence?: string;
  durationSeconds: number;
  operations: EditingDryRunOperation[];
  validation: {
    valid: boolean;
    gaps: Array<{ start: number; end: number }>;
    overlaps: Array<{ previousEnd: number; nextStart: number }>;
    warnings: string[];
  };
  safety: {
    mutatesPremiere: false;
    savesProject: false;
    requiresBackupBeforeApply: true;
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildEditingDryRun(input: EditingDryRunRequest): EditingDryRun {
  if (!input || !Array.isArray(input.decisions) || !input.decisions.length) {
    throw new Error("decisions must contain at least one edit decision.");
  }

  const decisions = input.decisions.map((decision, index) => {
    if (!decision || !finite(decision.start) || !finite(decision.end) || decision.end <= decision.start) {
      throw new Error(`decisions[${index}] has invalid timing.`);
    }
    if (typeof decision.clipId !== "string" || !decision.clipId.trim()) {
      throw new Error(`decisions[${index}] requires clipId.`);
    }
    if (!["cut", "hold", "punch-in"].includes(decision.action)) {
      throw new Error(`decisions[${index}] has invalid action.`);
    }
    return { ...decision, clipId: decision.clipId.trim() };
  }).sort((a, b) => a.start - b.start);

  const gaps: Array<{ start: number; end: number }> = [];
  const overlaps: Array<{ previousEnd: number; nextStart: number }> = [];
  const warnings: string[] = [];

  if (decisions[0].start > 0.01) gaps.push({ start: 0, end: decisions[0].start });
  for (let i = 1; i < decisions.length; i++) {
    const previous = decisions[i - 1];
    const current = decisions[i];
    if (current.start > previous.end + 0.01) gaps.push({ start: previous.end, end: current.start });
    if (current.start < previous.end - 0.01) overlaps.push({ previousEnd: previous.end, nextStart: current.start });
  }

  const inferredDuration = decisions.at(-1)?.end ?? 0;
  const durationSeconds = finite(input.durationSeconds) && input.durationSeconds! > 0 ? input.durationSeconds! : inferredDuration;
  if (inferredDuration < durationSeconds - 0.01) gaps.push({ start: inferredDuration, end: durationSeconds });

  if (decisions.length <= 2 && durationSeconds >= 60) warnings.push("Edit contains very little camera variation for its runtime; review creatively before applying.");
  if (decisions.some((decision) => decision.end - decision.start >= 40)) warnings.push("One or more holds are 40 seconds or longer; verify they are intentional before applying.");

  const operations: EditingDryRunOperation[] = decisions.map((decision, index) => ({
    index,
    kind: decision.action === "punch-in" ? "punch-in" : decision.action === "hold" ? "hold-source" : "activate-source",
    clipId: decision.clipId,
    timelineStart: decision.start,
    timelineEnd: decision.end,
    duration: decision.end - decision.start,
    destructive: false,
    note: `Preview only: keep ${decision.clipId} active from ${decision.start.toFixed(3)}s to ${decision.end.toFixed(3)}s${decision.action === "punch-in" ? " with a punch-in treatment" : ""}.`,
  }));

  return {
    version: "freeos-premiere-dry-run-v1",
    mode: "preview-only",
    project: input.project,
    sequence: input.sequence,
    durationSeconds,
    operations,
    validation: {
      valid: overlaps.length === 0,
      gaps,
      overlaps,
      warnings,
    },
    safety: {
      mutatesPremiere: false,
      savesProject: false,
      requiresBackupBeforeApply: true,
    },
  };
}
