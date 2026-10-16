import type { EditingPlannerRequest, JsonObject } from "../planning/plannerTypes";

export type EditClass = "performance" | "interview" | "documentary" | "wedding-event" | "social" | "commercial" | "cinematic" | "montage";
export interface ProjectProfile {
  primary: EditClass;
  secondary: EditClass[];
  sourceCount: number;
  characteristics: string[];
  academyQuery: string;
  criticPriorities: string[];
}

const signals: [EditClass, RegExp][] = [
  ["interview", /\b(interview|talking head|conversation|podcast)\b/i],
  ["documentary", /\b(documentary|nonfiction|observational|reportage)\b/i],
  ["wedding-event", /\b(wedding|ceremony|event|vows|reception)\b/i],
  ["social", /\b(social|short.form|reel|tiktok|vertical)\b/i],
  ["commercial", /\b(commercial|advert|product|brand campaign)\b/i],
  ["cinematic", /\b(cinematic|atmospheric|mood film|ambient)\b/i],
  ["performance", /\b(performance|music video|multicam|concert|live music)\b/i],
];

export function classifyProject(input: EditingPlannerRequest, videos: JsonObject[], audio: JsonObject): ProjectProfile {
  const intent = input.userIntent?.trim() ?? "";
  const matches = signals.filter(([, pattern]) => pattern.test(intent)).map(([kind]) => kind);
  const primary = matches[0] ?? "montage";
  const secondary = matches.slice(1);
  const characteristics = [
    videos.length > 1 ? "multiple synchronized video sources" : "single video source",
    Array.isArray(audio.sections) && audio.sections.length ? "measured audio sections" : "no detected audio sections",
    Array.isArray(audio.transientMoments) && audio.transientMoments.length ? "measured audio transients" : "no detected transients",
  ];
  const criticPriorities = primary === "interview" || primary === "documentary"
    ? ["continuity", "readability", "source coverage", "unsupported semantics"]
    : primary === "social"
      ? ["readability", "pacing", "visual progression", "repetition"]
      : ["motivation", "pacing", "repetition", "source coverage", "visual progression"];
  return {
    primary, secondary, sourceCount: videos.length, characteristics,
    academyQuery: `${primary} editing ${intent || "visual continuity pacing source availability"} ${characteristics.join(" ")}`.trim(),
    criticPriorities,
  };
}
