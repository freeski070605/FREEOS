import type { EditingDecision, JsonObject } from "../planning/plannerTypes";
import { asObject, number } from "../shared";
import { creativeIntents, renderEvidenceRationale, type EvidenceRecord } from "../evidence/evidenceRefs";
import { availableOpeningClips, deterministicOpening, type SectionOpeningState } from "../planning/openingState";

export class SectionValidationError extends Error {
  constructor(public readonly category: string, message: string) { super(`${category}: ${message}`); }
}

function groundedRationale(raw: JsonObject, at: number, catalog: EvidenceRecord[], allowedClipIds: Set<string>, label: string): string {
  const allowed = new Set(["at", "clipId", "action", "confidence", "creativeIntent", "evidenceRefs"]);
  if (label === "Section opening") allowed.add("mode");
  const extra = Object.keys(raw).filter((key) => !allowed.has(key));
  if (extra.length) throw new SectionValidationError("invalid-evidence-reference", `${label} contains unsupported fields: ${extra.join(", ")}.`);
  if (!creativeIntents.includes(raw.creativeIntent as typeof creativeIntents[number])) {
    throw new SectionValidationError("unsupported-creative-intent", `${label} has unsupported creativeIntent.`);
  }
  if (!Array.isArray(raw.evidenceRefs) || !raw.evidenceRefs.length || raw.evidenceRefs.length > 8) {
    throw new SectionValidationError("missing-evidence-reference", `${label} needs 1-8 evidenceRefs.`);
  }
  const refs = raw.evidenceRefs.map((id) => {
    if (typeof id !== "string") throw new SectionValidationError("invalid-evidence-reference", `${label} has a non-string evidence reference.`);
    const record = catalog.find((item) => item.id === id);
    if (!record) throw new SectionValidationError("invalid-evidence-reference", `${label} references unknown evidence '${id}'.`);
    if (record.clipId && !allowedClipIds.has(record.clipId)) throw new SectionValidationError("invalid-evidence-reference", `${label} references evidence for unknown clip '${record.clipId}'.`);
    if (Math.abs(record.at - at) > 0.8) throw new SectionValidationError("non-local-evidence", `${label} at ${at.toFixed(3)}s cites ${record.type} at ${record.at.toFixed(3)}s.`);
    return record;
  });
  if (new Set(raw.evidenceRefs).size !== refs.length) throw new SectionValidationError("invalid-evidence-reference", `${label} repeats an evidence reference.`);
  return renderEvidenceRationale(refs);
}
function findCandidateMomentNear(
  candidateEditMoments: JsonObject[],
  at: number,
  tolerance = 0.01
): JsonObject | undefined {
  return candidateEditMoments
    .filter((moment) => {
      const candidateAt = number(
        moment.at,
        NaN
      );

      return (
        Number.isFinite(candidateAt) &&
        Math.abs(candidateAt - at) <= tolerance
      );
    })
    .sort(
      (a, b) =>
        Math.abs(number(a.at, 0) - at) -
        Math.abs(number(b.at, 0) - at)
    )[0];
}


function candidateReasonCount(
  moment: JsonObject | undefined
): number {
  if (!moment) {
    return 0;
  }

  return Array.isArray(moment.reasons)
    ? moment.reasons.filter(
        (reason) =>
          typeof reason === "string" &&
          reason.trim().length > 0
      ).length
    : 0;
}


function isStrongLocalEditMoment(
  moment: JsonObject | undefined
): boolean {
  if (!moment) {
    return false;
  }

  const score = number(
    moment.score,
    0
  );

  const reasons =
    candidateReasonCount(moment);

  return (
    score >= 10 ||
    (
      score >= 8.75 &&
      reasons >= 2
    )
  );
}


export function sanitizeGroundedEditorialText(
  value: string
): string {
  return value
    .replace(
      /\bbacking\s+singers?\b/gi,
      "multiple detected faces"
    )
    .replace(
      /\bperformers?\b/gi,
      "visible subject"
    )
    .replace(
      /\bperformance\b/gi,
      "visual"
    )
    .replace(
      /\bgroup\s+(?:shot|performance|energy|context|view|visibility)\b/gi,
      "multi-face framing"
    )
    .replace(
      /\bgroup\b/gi,
      "multi-face"
    )
    .replace(
      /\bensemble\b/gi,
      "multi-face framing"
    )
    .replace(
      /\b(?:audience|crowd)\b/gi,
      "visible subjects"
    )
    .replace(
      /\b(?:vocal|vocals|lyric|lyrics|harmony|solo|instrumental|instrument|instruments|melody|melodic)\b/gi,
      "audio event"
    )
    .replace(
      /\b(?:verse|chorus|bridge|hook|pre-chorus|breakdown)\b/gi,
      "audio section"
    )
    .replace(
      /\s{2,}/g,
      " "
    )
    .trim();
}


function assertNoMechanicalCameraPingPong(
  points: Array<{
    at: number;
    clipId: string;
    rationale: string;
  }>,
  candidateEditMoments: JsonObject[]
): void {
  if (points.length < 3) {
    return;
  }

  /*
   * Ultra-short A -> B -> A.
   */
  for (
    let index = 0;
    index + 2 < points.length;
    index += 1
  ) {
    const a = points[index];
    const b = points[index + 1];
    const c = points[index + 2];

    if (
      a.clipId !== c.clipId ||
      a.clipId === b.clipId
    ) {
      continue;
    }

    if (
      b.rationale.startsWith("Availability repair:") ||
      c.rationale.startsWith("Availability repair:")
    ) {
      continue;
    }

    const middleDuration =
      c.at - b.at;

    if (
      middleDuration < 0.75
    ) {
      throw new Error(
        `Mechanical camera bounce detected: '${a.clipId}' -> '${b.clipId}' -> '${c.clipId}' with only ${middleDuration.toFixed(3)}s on the middle camera.`
      );
    }

    if (
      middleDuration < 2.0
    ) {
      const entryMoment =
        findCandidateMomentNear(
          candidateEditMoments,
          b.at
        );

      const exitMoment =
        findCandidateMomentNear(
          candidateEditMoments,
          c.at
        );

      if (
        !isStrongLocalEditMoment(entryMoment) ||
        !isStrongLocalEditMoment(exitMoment)
      ) {
        throw new Error(
          `Short A-B-A return at ${b.at.toFixed(3)}-${c.at.toFixed(3)} lacks strong local evidence at both transitions.`
        );
      }
    }
  }


  /*
   * Mechanical A-B-A-B.
   */
  for (
    let index = 0;
    index + 3 < points.length;
    index += 1
  ) {
    const p0 = points[index];
    const p1 = points[index + 1];
    const p2 = points[index + 2];
    const p3 = points[index + 3];

    const alternating =
      p0.clipId === p2.clipId &&
      p1.clipId === p3.clipId &&
      p0.clipId !== p1.clipId;

    if (!alternating) {
      continue;
    }

    if (
      p1.rationale.startsWith("Availability repair:") ||
      p2.rationale.startsWith("Availability repair:") ||
      p3.rationale.startsWith("Availability repair:")
    ) {
      continue;
    }

    const d1 = p1.at - p0.at;
    const d2 = p2.at - p1.at;
    const d3 = p3.at - p2.at;

    if (
      d1 > 8.5 ||
      d2 > 8.5 ||
      d3 > 8.5
    ) {
      continue;
    }

    const evidence1 =
      findCandidateMomentNear(
        candidateEditMoments,
        p1.at
      );

    const evidence2 =
      findCandidateMomentNear(
        candidateEditMoments,
        p2.at
      );

    const evidence3 =
      findCandidateMomentNear(
        candidateEditMoments,
        p3.at
      );

    const fullyCorroborated =
      isStrongLocalEditMoment(evidence1) &&
      isStrongLocalEditMoment(evidence2) &&
      isStrongLocalEditMoment(evidence3);

    if (!fullyCorroborated) {
      throw new Error(
        `Mechanical A-B-A-B alternation detected between '${p0.clipId}' and '${p1.clipId}' at ${p0.at.toFixed(3)}, ${p1.at.toFixed(3)}, ${p2.at.toFixed(3)}, ${p3.at.toFixed(3)}.`
      );
    }
  }
}


export function sanitizeStructuredStrings<T>(
  value: T
): T {
  return JSON.parse(
    JSON.stringify(
      value,
      (_key, item) =>
        typeof item === "string"
          ? sanitizeGroundedEditorialText(item)
          : item
    )
  ) as T;
}

export function validateSectionSwitches(
  openingRaw: unknown,
  raw: unknown[],
  allowedClipIds: Set<string>,
  sectionStart: number,
  sectionEnd: number,
  videos: JsonObject[],
  candidateEditMoments: JsonObject[] = [],
  previousClipId = "",
  evidenceCatalog: EvidenceRecord[] = []
): EditingDecision[] {
  const available = availableOpeningClips(videos, sectionStart);
  const fixedOpening = deterministicOpening(previousClipId, videos, sectionStart);
  let opening: JsonObject;
  let openingState: SectionOpeningState;
  if (fixedOpening) {
    // Normal continuity and a uniquely legal availability handoff are system state.
    // Old model output may still contain an opening; normalize it without using its evidence.
    opening = {};
    openingState = fixedOpening;
  } else {
    opening = asObject(openingRaw, "section opening");
    const clipId = typeof opening.clipId === "string" ? opening.clipId : "";
    const mode = previousClipId ? "availability-transition" : "initial-selection";
    if (opening.mode !== mode) throw new SectionValidationError("structure", `Section opening requires mode '${mode}'.`);
    openingState = { mode, clipId };
  }
  const openingClipId = openingState.clipId;
  if (!allowedClipIds.has(openingClipId)) throw new Error(`Section opening references unknown clip '${openingClipId}'.`);
  if (!available.includes(openingClipId)) throw new Error(`Section opening clip '${openingClipId}' is unavailable at ${sectionStart}.`);
  const openingAction = fixedOpening ? (fixedOpening.mode === "continuation" ? "hold" : "cut") : opening.action;
  if (openingAction !== "cut" && openingAction !== "hold" && openingAction !== "punch-in") throw new Error("Section opening has invalid action.");
  const openingRationale = fixedOpening
    ? (fixedOpening.mode === "continuation"
      ? `Continues clip '${openingClipId}' from the preceding section.`
      : `Availability repair: uniquely available clip '${openingClipId}' begins at ${sectionStart.toFixed(3)}s.`)
    : groundedRationale(opening, sectionStart, evidenceCatalog, allowedClipIds, "Section opening");


  const switches =
    raw
      .map(
        (item, index) => {
          const s =
            asObject(
              item,
              `section switch ${index}`
            );

          const at =
            number(
              s.at,
              NaN
            );

          const clipId =
            typeof s.clipId === "string"
              ? s.clipId
              : "";

          const action =
            s.action;

          if (
            !Number.isFinite(at) ||
            at < sectionStart - 0.001 ||
            at >= sectionEnd
          ) {
            throw new Error(
              `Section switch ${index} has invalid timing.`
            );
          }

          if (
            !allowedClipIds.has(
              clipId
            )
          ) {
            throw new Error(
              `Section switch ${index} references unknown clip '${clipId}'.`
            );
          }

          if (
            action !== "cut" &&
            action !== "hold" &&
            action !== "punch-in"
          ) {
            throw new Error(
              `Section switch ${index} has invalid action.`
            );
          }

          /*
           * Section-planner calls pass real candidateEditMoments.
           * Legacy/global validation paths do not.
           *
           * Only enforce exact candidate membership when real
           * section-local evidence was supplied.
           */
          if (
            candidateEditMoments.length > 0
          ) {
            const candidateMoment =
              findCandidateMomentNear(
                candidateEditMoments,
                at
              );

            if (!candidateMoment) {
              throw new Error(
                `Section switch ${index} at ${at.toFixed(3)}s has no matching measured candidate edit moment.`
              );
            }
          }

          const rationale = groundedRationale(s, at, evidenceCatalog, allowedClipIds, `Section switch ${index}`);

          return {
            at,
            clipId,
            creativeIntent: s.creativeIntent as EditingDecision["creativeIntent"],
            evidenceRefs: s.evidenceRefs as string[],

            action:
              action as EditingDecision["action"],

            confidence:
              Math.max(
                0,
                Math.min(
                  1,
                  number(
                    s.confidence,
                    0.5
                  )
                )
              ),

            rationale,
          };
        }
      )
      .sort(
        (a, b) =>
          a.at - b.at ||
          b.confidence - a.confidence
      );


  const unique =
    switches.filter(
      (item, index) =>
        index === 0 ||
        Math.abs(
          item.at -
          switches[index - 1].at
        ) > 0.001
    );


  const points = [
    {
      at: sectionStart,
      clipId: openingClipId,

      action:
        openingAction as EditingDecision["action"],

      confidence:
        Math.max(
          0,
          Math.min(
            1,
            number(
              opening.confidence,
              0.5
            )
          )
        ),

      rationale:
        openingRationale,
      creativeIntent: opening.creativeIntent as EditingDecision["creativeIntent"],
      evidenceRefs: opening.evidenceRefs as string[],
    },

    ...unique,
  ];

  // A real switch at the exact boundary replaces the zero-duration opening
  // segment, while the opening state remains available for continuity checks.
  const boundaryCreativeSwitch = unique.length > 0 && Math.abs(unique[0].at - sectionStart) <= 0.001;
  if (boundaryCreativeSwitch) {
    if (unique[0].clipId === openingClipId) throw new Error("Boundary creative switch must change the active clip.");
    points.shift();
  }


  /*
   * Preserve FREEOS creative choices while deterministically
   * repairing only unambiguous source overruns.
   */
  const repairedPoints: Array<{ at: number; clipId: string; action: EditingDecision["action"]; confidence: number; rationale: string; creativeIntent?: EditingDecision["creativeIntent"]; evidenceRefs?: string[] }> =
    points.map(
      (point) => ({
        ...point,
      })
    );

  let repairIndex = 0;

  while (
    repairIndex <
    repairedPoints.length
  ) {
    const item =
      repairedPoints[
        repairIndex
      ];

    const plannedEnd =
      repairIndex + 1 <
      repairedPoints.length
        ? repairedPoints[
            repairIndex + 1
          ].at
        : sectionEnd;

    if (
      plannedEnd <= item.at
    ) {
      throw new Error(
        `Section point ${repairIndex} does not advance the timeline.`
      );
    }

    const video =
      videos.find(
        (candidate) =>
          String(candidate.id) ===
          item.clipId
      );

    const availableStart =
      number(
        video?.timelineAvailableStart,
        0
      );

    const availableEnd =
      number(
        video?.timelineAvailableEnd,
        0
      );

    if (
      !video ||
      item.at <
        availableStart - 0.05
    ) {
      throw new Error(
        `Section point ${repairIndex} starts '${item.clipId}' outside source availability (${item.at} vs ${availableStart}-${availableEnd}).`
      );
    }

    if (
      plannedEnd <=
      availableEnd + 0.05
    ) {
      repairIndex += 1;
      continue;
    }

    const repairAt =
      Math.floor(
        availableEnd * 1000
      ) / 1000;

    if (
      !Number.isFinite(repairAt) ||
      repairAt <= item.at + 0.001 ||
      repairAt >= plannedEnd
    ) {
      throw new Error(
        `Cannot safely repair source overrun for '${item.clipId}' at ${item.at}-${plannedEnd}; source ends at ${availableEnd}.`
      );
    }

    const legalContinuations =
      videos.filter(
        (candidate) => {
          const candidateId =
            String(candidate.id);

          const candidateStart =
            number(
              candidate.timelineAvailableStart,
              0
            );

          const candidateEnd =
            number(
              candidate.timelineAvailableEnd,
              0
            );

          return (
            candidateId !== item.clipId &&
            allowedClipIds.has(candidateId) &&
            repairAt >= candidateStart - 0.05 &&
            plannedEnd <= candidateEnd + 0.05
          );
        }
      );

    const plannedNext =
      repairIndex + 1 <
      repairedPoints.length
        ? repairedPoints[
            repairIndex + 1
          ]
        : null;

    let continuation:
      JsonObject |
      undefined;

    if (plannedNext) {
      continuation =
        legalContinuations.find(
          (candidate) =>
            String(candidate.id) ===
            plannedNext.clipId
        );
    }

    if (
      !continuation &&
      legalContinuations.length === 1
    ) {
      continuation =
        legalContinuations[0];
    }

    if (!continuation) {
      const candidateIds =
        legalContinuations.map(
          (candidate) =>
            String(candidate.id)
        );

      throw new Error(
        `Section point ${repairIndex} keeps '${item.clipId}' past source availability (${item.at}-${plannedEnd} vs ${availableStart}-${availableEnd}) and automatic repair is ${
          candidateIds.length === 0
            ? "impossible because no legal continuation exists"
            : `ambiguous across legal continuations: ${candidateIds.join(", ")}`
        }.`
      );
    }

    const continuationId =
      String(
        continuation.id
      );

    repairedPoints.splice(
      repairIndex + 1,
      0,
      {
        at:
          repairAt,

        clipId:
          continuationId,

        action:
          "cut",

        confidence:
          Math.min(
            item.confidence,
            0.95
          ),

        rationale:
          `Availability repair: '${item.clipId}' ends at ${availableEnd.toFixed(3)}s, so FREEOS hands off at ${repairAt.toFixed(3)}s to '${continuationId}', the uniquely legal continuation through ${plannedEnd.toFixed(3)}s.`,
        creativeIntent: undefined,
        evidenceRefs: undefined,
      }
    );

    console.warn(
      `[FREEOS Editing Planner] repaired source overrun: ${item.clipId} -> ${continuationId} at ${repairAt.toFixed(3)}s`
    );

    repairIndex += 1;
  }


  /*
   * Candidate-strength anti-ping-pong analysis only belongs to the
   * section planner, because only it has section-local candidates.
   */
  if (
    candidateEditMoments.length > 0
  ) {
    assertNoMechanicalCameraPingPong(
      boundaryCreativeSwitch
        ? [{ at: sectionStart, clipId: openingClipId, rationale: openingRationale }, ...repairedPoints]
        : repairedPoints,
      candidateEditMoments
    );
  }


  return repairedPoints.map(
    (
      item,
      index
    ): EditingDecision => {
      const end =
        index + 1 <
        repairedPoints.length
          ? repairedPoints[
              index + 1
            ].at
          : sectionEnd;

      if (
        end <= item.at
      ) {
        throw new Error(
          `Section point ${index} does not advance the timeline.`
        );
      }

      const video =
        videos.find(
          (candidate) =>
            String(candidate.id) ===
            item.clipId
        );

      const availableStart =
        number(
          video?.timelineAvailableStart,
          0
        );

      const availableEnd =
        number(
          video?.timelineAvailableEnd,
          0
        );

      if (
        !video ||
        item.at <
          availableStart - 0.05 ||
        end >
          availableEnd + 0.05
      ) {
        throw new Error(
          `Section point ${index} keeps '${item.clipId}' on screen outside source availability (${item.at}-${end} vs ${availableStart}-${availableEnd}).`
        );
      }

      return {
        start:
          item.at,

        end,

        clipId:
          item.clipId,

        action:
          item.action,

        confidence:
          item.confidence,

        rationale:
          item.rationale,
        ...(item.creativeIntent ? { creativeIntent: item.creativeIntent } : {}),
        ...(item.evidenceRefs ? { evidenceRefs: item.evidenceRefs } : {}),
      };
    }
  );
}
