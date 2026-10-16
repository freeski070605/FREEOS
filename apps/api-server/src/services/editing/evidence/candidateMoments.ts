import type { JsonObject } from "../planning/plannerTypes";
import { number } from "../shared";
function collectBoundaryTimes(
  value: unknown
): number[] {
  const result: number[] = [];

  const visit = (item: unknown): void => {
    if (
      typeof item === "number" &&
      Number.isFinite(item)
    ) {
      result.push(item);
      return;
    }

    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      return;
    }

    const object = item as JsonObject;

    const keys = [
      "time",
      "start",
      "end",
      "startTime",
      "endTime",
      "startSeconds",
      "endSeconds",
    ];

    for (const key of keys) {
      const candidate = number(
        object[key],
        NaN
      );

      if (Number.isFinite(candidate)) {
        result.push(candidate);
      }
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item);
    }
  }
  else {
    visit(value);
  }

  return result;
}


export function buildSectionEditMoments(
  audio: JsonObject,
  videos: JsonObject[],
  sectionStart: number,
  sectionEnd: number
): JsonObject[] {
  type Candidate = {
    at: number;
    score: number;
    reasons: string[];
  };

  const candidates: Candidate[] = [];

  const add = (
    rawAt: number,
    score: number,
    reason: string
  ): void => {
    if (!Number.isFinite(rawAt)) {
      return;
    }

    const at = Number(
      rawAt.toFixed(3)
    );

    if (
      at <= sectionStart + 0.15 ||
      at >= sectionEnd - 0.15
    ) {
      return;
    }

    candidates.push({
      at,
      score,
      reasons: [reason],
    });
  };


  /*
   * Exact measured transients.
   */
  const transientMoments =
    Array.isArray(audio.transientMoments)
      ? audio.transientMoments as JsonObject[]
      : [];

  const sectionTransients =
    transientMoments.filter((item) => {
      const at = number(item.time, NaN);

      return (
        Number.isFinite(at) &&
        at > sectionStart + 0.15 &&
        at < sectionEnd - 0.15
      );
    });

  const maxTransientStrength =
    sectionTransients.reduce(
      (maximum, item) =>
        Math.max(
          maximum,
          number(item.strength, 0)
        ),
      0
    );

  for (const transient of sectionTransients) {
    const strength = number(
      transient.strength,
      0
    );

    const normalized =
      maxTransientStrength > 0
        ? strength / maxTransientStrength
        : 0;

    add(
      number(transient.time, NaN),
      7 + normalized * 4,
      `audio transient strength=${strength.toFixed(3)}`
    );
  }


  /*
   * Downbeats are deliberately low priority.
   * They must not become another rhythmic grid.
   */
  for (
    const at of collectBoundaryTimes(
      audio.downbeats
    )
  ) {
    add(
      at,
      2.5,
      "measured downbeat"
    );
  }


  /*
   * Measured section boundaries.
   * No invented verse/chorus labels.
   */
  for (
    const at of collectBoundaryTimes(
      audio.sections
    )
  ) {
    add(
      at,
      9,
      "measured audio section boundary"
    );
  }


  /*
   * Measured silence boundaries.
   */
  for (
    const at of collectBoundaryTimes(
      audio.silenceRegions
    )
  ) {
    add(
      at,
      9.5,
      "measured silence boundary"
    );
  }


  /*
   * Exact visual scene/motion evidence.
   */
  for (const video of videos) {
    const clipId = String(video.id);

    const moments =
      Array.isArray(video.editMoments)
        ? video.editMoments as JsonObject[]
        : [];

    for (const moment of moments) {
      const at = number(
        moment.time,
        NaN
      );

      const type =
        typeof moment.type === "string"
          ? moment.type
          : "visual-change";

      const strength = number(
        moment.strength,
        0
      );

      const score =
        type === "scene-change"
          ? 8 + Math.min(3, strength * 3)
          : 5 + Math.min(2, strength * 2);

      add(
        at,
        score,
        `${clipId} ${type} strength=${strength.toFixed(3)}`
      );
    }


    /*
     * Physical media boundaries are valid editing evidence.
     */
    add(
      number(
        video.timelineAvailableStart,
        NaN
      ),
      10,
      `${clipId} source becomes available`
    );

    add(
      number(
        video.timelineAvailableEnd,
        NaN
      ),
      10,
      `${clipId} source availability ends`
    );
  }


  /*
   * Merge near-simultaneous evidence.
   */
  const sorted =
    candidates.sort(
      (a, b) =>
        a.at - b.at
    );

  const merged: Candidate[] = [];

  for (const candidate of sorted) {
    const previous = merged.at(-1);

    if (
      previous &&
      Math.abs(
        previous.at - candidate.at
      ) <= 0.30
    ) {
      previous.reasons.push(
        ...candidate.reasons
      );

      if (
        candidate.score >
        previous.score
      ) {
        previous.at = candidate.at;
        previous.score = candidate.score;
      }
      else {
        previous.score = Math.max(
          previous.score,
          candidate.score
        );
      }

      continue;
    }

    merged.push({
      at: candidate.at,
      score: candidate.score,
      reasons: [...candidate.reasons],
    });
  }


  /*
   * Keep strongest editorial opportunities only.
   *
   * The model may use NONE, SOME, or MANY of these.
   */
  return merged
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 32)
    .sort(
      (a, b) =>
        a.at - b.at
    )
    .map((item) => ({
      at: Number(
        item.at.toFixed(3)
      ),
      score: Number(
        item.score.toFixed(3)
      ),
      reasons: item.reasons.slice(0, 6),
    }));
}


