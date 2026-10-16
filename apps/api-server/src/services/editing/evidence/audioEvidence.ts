import type { JsonObject } from "../planning/plannerTypes";
import { asObject, number, mean, dominantString } from "../shared";
export function compactAudio(raw: unknown): JsonObject {
  const a = asObject(raw, "audio analysis");

  const energy =
    Array.isArray(a.energyCurve)
      ? a.energyCurve as JsonObject[]
      : [];

  const transients =
    Array.isArray(a.transients)
      ? a.transients as JsonObject[]
      : [];

  const beats =
    Array.isArray(a.beats)
      ? a.beats as JsonObject[]
      : [];

  const windowSeconds = 4;
  const duration = number(a.durationSeconds, 0);
  const windows: JsonObject[] = [];

  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);

    const energies = energy
      .filter(
        (e) =>
          number(e.time, -1) >= start &&
          number(e.time, -1) < end
      )
      .map((e) => number(e.rms, NaN));

    const peaks = energy
      .filter(
        (e) =>
          number(e.time, -1) >= start &&
          number(e.time, -1) < end
      )
      .map((e) => number(e.peak, NaN));

    const windowTransients = transients.filter(
      (e) =>
        number(e.time, -1) >= start &&
        number(e.time, -1) < end
    );

    const windowBeats = beats.filter(
      (e) =>
        number(e.time, -1) >= start &&
        number(e.time, -1) < end
    );

    windows.push({
      start,
      end,
      energyMean: mean(energies),
      peakMean: mean(peaks),
      transientCount: windowTransients.length,
      strongestTransient:
        windowTransients.reduce(
          (m, e) =>
            Math.max(
              m,
              number(e.strength, 0)
            ),
          0
        ),
      beatCount: windowBeats.length,
    });
  }

  /*
   * Preserve exact measured transient times.
   *
   * These are candidate editorial events, NOT automatic cuts.
   */
  const transientMoments = transients
    .map((item) => ({
      time: number(item.time, NaN),
      strength: number(item.strength, 0),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.time) &&
        item.time >= 0 &&
        item.time <= duration
    )
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 256)
    .sort((a, b) => a.time - b.time);

  /*
   * Preserve exact beats as low-priority evidence.
   * They are deliberately not treated as a required cut grid.
   */
  const beatMoments = beats
    .map((item) => ({
      time: number(item.time, NaN),
      strength: number(item.strength, 0),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.time) &&
        item.time >= 0 &&
        item.time <= duration
    )
    .slice(0, 512);

  return {
    durationSeconds: a.durationSeconds,
    tempo: a.tempo,
    downbeats: Array.isArray(a.downbeats) ? a.downbeats : [],
    sections: Array.isArray(a.sections) ? a.sections : [],
    loudness: a.loudness,
    silenceRegions: a.silenceRegions,
    intro: a.intro,
    outro: a.outro,
    windows,
    transientMoments,
    beatMoments,
    analysisVersion: a.analysisVersion,
  };
}
