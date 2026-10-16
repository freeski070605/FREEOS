import type { JsonObject } from "./plannerTypes";
import { number } from "../shared";
import { creativeIntents, type EvidenceRecord } from "../evidence/evidenceRefs";
import { deterministicOpening } from "./openingState";
import type { OpeningEvidenceScope } from "../evidence/openingEvidence";
export const creativeBriefSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["creativeSummary", "principles", "cautions"],
  properties: {
    creativeSummary: { type: "string", maxLength: 2400 },
    principles: { type: "array", maxItems: 12, items: { type: "string", maxLength: 220 } },
    cautions: { type: "array", maxItems: 20, items: { type: "string", maxLength: 220 } },
  },
};

export function buildCameraProfileSchema(clipIds: string[]): JsonObject {
  const variants = clipIds.map((clipId) => ({
    type: "object",
    additionalProperties: false,
    required: ["clipId", "shotCharacter", "framingCharacter", "motionCharacter", "subjectVisibility", "strengths", "cautions", "confidence"],
    properties: {
      clipId: { const: clipId },
      shotCharacter: { type: "string", maxLength: 180 },
      framingCharacter: { type: "string", maxLength: 180 },
      motionCharacter: { type: "string", maxLength: 180 },
      subjectVisibility: { type: "string", maxLength: 180 },
      strengths: { type: "array", maxItems: 6, items: { type: "string", maxLength: 180 } },
      cautions: { type: "array", maxItems: 6, items: { type: "string", maxLength: 180 } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  }));

  return {
    type: "object",
    additionalProperties: false,
    required: ["profiles"],
    properties: {
      profiles: {
        type: "array",
        minItems: clipIds.length,
        maxItems: clipIds.length,
        items: { oneOf: variants },
      },
    },
  };
}
export function buildBoundaryPruneSchema(candidateTimes: number[]): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["removeSwitches"],
    properties: {
      removeSwitches: {
        type: "array",
        uniqueItems: true,
        maxItems: candidateTimes.length,
        items: candidateTimes.length
          ? { type: "number", enum: candidateTimes }
          : { type: "number", enum: [] },
      },
    },
  };
}
export function buildSectionPlanSchema(
  sectionStart: number,
  sectionEnd: number,
  videos: JsonObject[],
  candidateTimes: number[],
  evidenceCatalog: EvidenceRecord[] = [],
  previousClipId = "",
  openingScope?: OpeningEvidenceScope,
  supportByTime?: Map<number, Record<string, string[]>>
): JsonObject {
  const fixedOpening = deterministicOpening(previousClipId, videos, sectionStart);
  const evidenceRefs = { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: { type: "string", enum: evidenceCatalog.map((item) => item.id) } };
  const creativeIntent = { type: "string", enum: [...creativeIntents] };
  const uniqueCandidateTimes =
    Array.from(
      new Set(
        candidateTimes
          .filter(
            (value) =>
              Number.isFinite(value) &&
              value >= sectionStart - 0.001 &&
              value < sectionEnd - 0.001
          )
          .map(
            (value) =>
              Number(value.toFixed(3))
          )
      )
    )
    .sort(
      (a, b) =>
        a - b
    );


  const openingVariants =
    videos.flatMap((video) => {
      const id = String(video.id);

      const availableStart = number(
        video.timelineAvailableStart,
        sectionStart
      );

      const availableEnd = number(
        video.timelineAvailableEnd,
        sectionEnd
      );

      if (
        availableStart > sectionStart + 0.001 ||
        availableEnd <= sectionStart + 0.001
      ) {
        return [];
      }

      return [{
        type: "object",
        additionalProperties: false,

        required: [
          "mode",
          "clipId",
          "action",
          "confidence",
          "creativeIntent",
          "evidenceRefs",
        ],

        properties: {
          mode: { const: previousClipId ? "availability-transition" : "initial-selection" },
          clipId: {
            const: id,
          },

          action: {
            type: "string",
            enum: [
              "cut",
              "hold",
              "punch-in",
            ],
          },

          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },

          creativeIntent,
          evidenceRefs: !previousClipId && openingScope ? { ...evidenceRefs, items: { type: "string", enum: evidenceCatalog.filter((item) => item.at >= openingScope.start && item.at <= openingScope.end && (!item.clipId || item.clipId === id)).map((item) => item.id) } } : evidenceRefs,
        },
      }];
    });


  const switchVariants =
    videos.flatMap((video) => {
      const id = String(video.id);

      const availableStart = Math.max(
        sectionStart,
        number(
          video.timelineAvailableStart,
          sectionStart
        )
      );

      const availableEnd = Math.min(
        sectionEnd,
        number(
          video.timelineAvailableEnd,
          sectionEnd
        )
      );

      if (
        availableEnd <= availableStart
      ) {
        return [];
      }

      /*
       * Only evidence-backed moments can become switchpoints.
       * No synthetic half-second grid.
       */
      const legalTimes =
        uniqueCandidateTimes.filter(
          (at) =>
            at + 0.001 >= availableStart &&
            at < availableEnd - 0.001 && (!supportByTime || (supportByTime.get(at)?.[id]?.length ?? 0) > 0)
        );


      /*
       * Exact source availability starts remain legal.
       */
      const exactStart = Number(
        availableStart.toFixed(3)
      );

      if (
        exactStart > sectionStart + 0.001 &&
        exactStart < availableEnd &&
        !legalTimes.includes(exactStart) &&
        (!supportByTime || (supportByTime.get(exactStart)?.[id]?.length ?? 0) > 0 ||
          videos.filter((item) => number(item.timelineAvailableStart, 0) <= exactStart + 0.001 && number(item.timelineAvailableEnd, 0) > exactStart + 0.001).length === 1)
      ) {
        legalTimes.push(exactStart);
      }

      legalTimes.sort(
        (a, b) =>
          a - b
      );

      if (!legalTimes.length) {
        return [];
      }

      return [{
        type: "object",
        additionalProperties: false,

        required: [
          "at",
          "clipId",
          "action",
          "confidence",
          "creativeIntent",
          "evidenceRefs",
        ],

        properties: {
          at: {
            type: "number",
            enum: legalTimes,
          },

          clipId: {
            const: id,
          },

          action: {
            type: "string",
            enum: [
              "cut",
              "hold",
              "punch-in",
            ],
          },

          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },

          creativeIntent,
          evidenceRefs,
        },
      }];
    });


  if (!openingVariants.length) {
    throw new Error(
      `No video source is available at section start ${sectionStart}.`
    );
  }

  return {
    type: "object",
    additionalProperties: false,

    required: fixedOpening ? ["switches"] : ["opening", "switches"],

    properties: {
      ...(!fixedOpening ? { opening: { oneOf: openingVariants } } : {}),

      switches:
        switchVariants.length
          ? {
              type: "array",
              maxItems: Math.min(
                19,
                uniqueCandidateTimes.length
              ),
              items: {
                oneOf: switchVariants,
              },
            }
          : {
              type: "array",
              maxItems: 0,
            },

    },
  };
}
