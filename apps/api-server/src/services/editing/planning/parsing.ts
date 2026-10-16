import type { CreativeBrief, CameraProfile, JsonObject } from "./plannerTypes";
import { asObject, number } from "../shared";
export function parseCreativeBrief(text: string): CreativeBrief {
  const parsed = asObject(JSON.parse(text), "creative brief");
  return {
    creativeSummary: typeof parsed.creativeSummary === "string" ? parsed.creativeSummary.slice(0, 3000) : "",
    principles: Array.isArray(parsed.principles) ? parsed.principles.filter((v): v is string => typeof v === "string").slice(0, 12) : [],
    cautions: Array.isArray(parsed.cautions) ? parsed.cautions.filter((v): v is string => typeof v === "string").slice(0, 20) : [],
  };
}

export function parseCameraProfiles(text: string, clipIds: string[]): CameraProfile[] {
  const parsed = asObject(JSON.parse(text), "camera profile response");
  const rawProfiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  if (rawProfiles.length !== clipIds.length) {
    throw new Error(`FREEOS returned ${rawProfiles.length} camera profiles for ${clipIds.length} clips.`);
  }

  const allowed = new Set(clipIds);
  const seen = new Set<string>();
  const profiles = rawProfiles.map((item, index): CameraProfile => {
    const profile = asObject(item, `camera profile ${index}`);
    const clipId = typeof profile.clipId === "string" ? profile.clipId : "";
    if (!allowed.has(clipId)) throw new Error(`Camera profile ${index} references unknown clip '${clipId}'.`);
    if (seen.has(clipId)) throw new Error(`Camera profile duplicated clip '${clipId}'.`);
    seen.add(clipId);
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 6) : [];
    return {
      clipId,
      shotCharacter: typeof profile.shotCharacter === "string" ? profile.shotCharacter.slice(0, 240) : "unknown",
      framingCharacter: typeof profile.framingCharacter === "string" ? profile.framingCharacter.slice(0, 240) : "unknown",
      motionCharacter: typeof profile.motionCharacter === "string" ? profile.motionCharacter.slice(0, 240) : "unknown",
      subjectVisibility: typeof profile.subjectVisibility === "string" ? profile.subjectVisibility.slice(0, 240) : "unknown",
      strengths: strings(profile.strengths),
      cautions: strings(profile.cautions),
      confidence: Math.max(0, Math.min(1, number(profile.confidence, 0.5))),
    };
  });

  for (const clipId of clipIds) if (!seen.has(clipId)) throw new Error(`Camera profile missing clip '${clipId}'.`);
  return profiles;
}
export function parseSectionPlan(text: string): { opening: unknown; switches: unknown[]; cautions: string[] } {
  const parsed = asObject(JSON.parse(text), "section plan");
  const extra = Object.keys(parsed).filter((key) => key !== "opening" && key !== "switches");
  if (extra.length) throw new Error(`Section plan contains unsupported free-text fields: ${extra.join(", ")}.`);
  if (!Array.isArray(parsed.switches)) throw new Error("Section plan switches must be an array.");
  return {
    opening: parsed.opening,
    switches: parsed.switches,
    cautions: [],
  };
}

