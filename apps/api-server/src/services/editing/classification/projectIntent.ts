import type { EditingPlannerRequest } from "../planning/plannerTypes";

export interface EditingIntentLayers {
  universalPrinciples: string[];
  ownerPreferences: string[];
  projectIntent: string;
}

export function resolveEditingIntent(input: EditingPlannerRequest): EditingIntentLayers {
  return {
    universalPrinciples: [
      "Use measured evidence for factual claims.",
      "Keep cuts source-valid and temporally coherent.",
      "Avoid unjustified mechanical camera alternation.",
    ],
    ownerPreferences: (input.ownerPreferences ?? []).filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim().slice(0, 220)),
    projectIntent: input.userIntent?.trim() || "Create a coherent edit from the available footage.",
  };
}
