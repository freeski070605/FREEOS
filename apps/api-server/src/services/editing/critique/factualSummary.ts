import type { EditingDecision } from "../planning/plannerTypes";

// The public summary uses only validated decisions and their canonical rendered evidence.
export function factualEvidenceSummary(decisions: EditingDecision[]): string {
  const sceneChanges = decisions.slice(1).filter((decision) => /measured scene change/i.test(decision.rationale)).length;
  return `Validated edit: ${decisions.length} shots across ${new Set(decisions.map((decision) => decision.clipId)).size} supplied sources. ${sceneChanges} switches cite measured scene-change evidence.`;
}
