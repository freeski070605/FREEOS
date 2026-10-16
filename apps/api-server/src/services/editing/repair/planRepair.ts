export interface RepairDiagnostic { attempt: number; category: string; message: string }
export class PlanRepairError extends Error {
  constructor(public readonly diagnostics: RepairDiagnostic[]) {
    super(`Plan repair failed after ${diagnostics.length} attempts: ${diagnostics.at(-1)?.message ?? "unknown failure"}`);
  }
}
export async function runBoundedPlanRepair<T>(options: {
  maxAttempts: number;
  generate: (attempt: number, previous?: RepairDiagnostic) => Promise<unknown>;
  validate: (generated: unknown) => T;
  classify?: (error: unknown) => string;
  onFailure?: (diagnostic: RepairDiagnostic) => void;
}): Promise<{ value: T; attempts: number; diagnostics: RepairDiagnostic[] }> {
  const diagnostics: RepairDiagnostic[] = [];
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const generated = await options.generate(attempt, diagnostics.at(-1));
      return { value: options.validate(generated), attempts: attempt, diagnostics };
    } catch (error) {
      const diagnostic = { attempt, category: options.classify?.(error) ?? "validation", message: error instanceof Error ? error.message : String(error) };
      diagnostics.push(diagnostic);
      options.onFailure?.(diagnostic);
      if (diagnostic.category === "context-budget") throw error;
    }
  }
  throw new PlanRepairError(diagnostics);
}
