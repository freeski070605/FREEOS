import type { EditingPlannerClipInput, JsonObject } from "../planning/plannerTypes";
import { asObject, number, mean, dominantString } from "../shared";
export function compactVideo(raw: unknown, input: EditingPlannerClipInput): JsonObject {
  const v = asObject(raw, `video analysis for ${input.id}`);
  const timeline = Array.isArray(v.timeline) ? v.timeline as JsonObject[] : [];
  const duration = number(v.durationSeconds, 0);
  const offset = input.timelineOffsetSeconds ?? 0;
  const windowSeconds = 4;
  const windows: JsonObject[] = [];
  const frameTimes = timeline.map((frame) => number(frame.time, NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  const orderedFrames = [...timeline].sort((a, b) => number(a.time, Infinity) - number(b.time, Infinity));
  const gaps = frameTimes.slice(1).map((time, index) => time - frameTimes[index]).filter((gap) => gap > 0);
  const sampleCadence = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : NaN;
  const stateIntervals: JsonObject[] = [];
  const stateSpecs = [
    { type: "face-presence", key: "faceCount", binary: true },
    { type: "camera-motion", key: "globalMotion" },
    { type: "motion-state", key: "motion" },
    { type: "sharpness", key: "sharpness" },
    { type: "exposure", key: "brightness" },
    { type: "framing", key: "framingRole", label: true },
  ];
  for (const spec of stateSpecs) {
    const samples = orderedFrames.flatMap((frame) => {
      const at = number(frame.time, NaN) + offset;
      const rawValue = spec.label ? frame[spec.key] ?? frame.shotScale : frame[spec.key];
      const value = spec.binary ? Number(number(rawValue, NaN) > 0) : number(rawValue, NaN);
      const label = typeof rawValue === "string" ? rawValue.toLowerCase() : "";
      return Number.isFinite(at) && (spec.label ? /^(?:wide|medium|close|tight|long|full|mid)(?:[ -](?:shot|up|view))?$/i.test(label) : Number.isFinite(number(rawValue, NaN)))
        ? [{ at, value, label }] : [];
    });
    let runStart = 0;
    for (let i = 1; i <= samples.length; i++) {
      const previous = samples[i - 1], next = samples[i];
      const same = next && (spec.label ? next.label === previous.label : Math.abs(next.value - previous.value) <= (spec.binary ? 0 : 0.025)) &&
        next.at - previous.at <= Math.min(1.5, Number.isFinite(sampleCadence) ? sampleCadence * 1.5 : 1.5);
      if (same) continue;
      const halfCadence = Math.min(0.4, Number.isFinite(sampleCadence) ? sampleCadence / 2 : 0);
      if (i - runStart >= 1 && halfCadence > 0) {
        const first = samples[runStart], last = samples[i - 1];
        stateIntervals.push({ type: spec.type, timelineStart: Math.max(offset, first.at - halfCadence), timelineEnd: Math.min(offset + duration, last.at + halfCadence),
          ...(spec.label ? { label: first.label } : { value: mean(samples.slice(runStart, i).map((sample) => sample.value)) }) });
      }
      runStart = i;
    }
  }
  const openingMeasurements: JsonObject[] = [];
  const firstMeasured = (type: string, key: string, label = false) => {
    const frame = orderedFrames
      .find((item) => Number.isFinite(number(item.time, NaN)) && (label ? typeof item[key] === "string" && /^(?:wide|medium|close|tight|long|full|mid)(?:[ -](?:shot|up|view))?$/i.test(String(item[key])) : Number.isFinite(number(item[key], NaN))));
    if (!frame) return;
    openingMeasurements.push({ type, at: number(frame.time, NaN) + offset,
      ...(label ? { label: String(frame[key]).toLowerCase() } : { value: key === "faceCount" ? Number(number(frame[key], 0) > 0) : number(frame[key], NaN) }) });
  };
  firstMeasured("framing", "framingRole", true);
  if (!openingMeasurements.some((item) => item.type === "framing")) firstMeasured("framing", "shotScale", true);
  firstMeasured("face-presence", "faceCount");
  const firstFace = openingMeasurements.find((item) => item.type === "face-presence");
  if (firstFace?.value === 0) {
    const firstPositive = orderedFrames.find((frame) => Number.isFinite(number(frame.time, NaN)) && number(frame.time, NaN) + offset <= offset + 2 && number(frame.faceCount, 0) > 0);
    if (firstPositive) openingMeasurements.push({ type: "face-presence", at: number(firstPositive.time, NaN) + offset, value: 1 });
  }
  firstMeasured("motion-state", "motion");
  firstMeasured("camera-motion", "globalMotion");
  firstMeasured("sharpness", "sharpness");
  firstMeasured("exposure", "brightness");
  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);
    const frames = timeline.filter((f) => number(f.time, -1) >= start && number(f.time, -1) < end);
    if (!frames.length) continue;
    const faces = frames.filter((f) => number(f.faceCount, 0) > 0);
    const largestFaces = faces.map((f) => f.largestFace).filter((f): f is JsonObject => !!f && typeof f === "object" && !Array.isArray(f));
    windows.push({
      sourceStart: start,
      sourceEnd: end,
      timelineStart: start + offset,
      timelineEnd: end + offset,
      sharpness: mean(frames.map((f) => number(f.sharpness, NaN))),
      brightness: mean(frames.map((f) => number(f.brightness, NaN))),
      motion: mean(frames.map((f) => number(f.motion, NaN))),
      sceneChangeMax: frames.reduce((m, f) => Math.max(m, number(f.sceneChange, 0)), 0),
      facePresence: faces.length / frames.length,
      multiFacePresence: frames.filter((f) => number(f.faceCount, 0) > 1).length / frames.length,
      primaryFaceArea: mean(largestFaces.map((f) => number(f.areaRatio, NaN))),
      primaryFaceCenterX: mean(largestFaces.map((f) => number(f.centerX, NaN))),
      primaryFaceCenterY: mean(largestFaces.map((f) => number(f.centerY, NaN))),
      underexposedFraction: mean(frames.map((f) => number(f.underexposedFraction, NaN))),
      overexposedFraction: mean(frames.map((f) => number(f.overexposedFraction, NaN))),
      personPresence: frames.filter((f) => number(f.personCount, 0) > 0).length / frames.length,
      personCountMean: mean(frames.map((f) => number(f.personCount, NaN))),
      subjectCountMean: mean(frames.map((f) => number(f.subjectCountEstimate, NaN))),
      primaryPersonArea: mean(frames.map((f) => {
        const person = f.largestPerson;
        return person && typeof person === "object" && !Array.isArray(person) ? number((person as JsonObject).areaRatio, NaN) : NaN;
      })),
      globalMotion: mean(frames.map((f) => number(f.globalMotion, NaN))),
      localMotion: mean(frames.map((f) => number(f.localMotion, NaN))),
      shotScale: dominantString(frames.map((f) => f.shotScale)),
      shotScaleConfidence: mean(frames.map((f) => number(f.shotScaleConfidence, NaN))),
      framingRole: dominantString(frames.map((f) => f.framingRole)),
      framingRoleConfidence: mean(frames.map((f) => number(f.framingRoleConfidence, NaN))),
      motionRole: dominantString(frames.map((f) => f.motionRole)),
      motionRoleConfidence: mean(frames.map((f) => number(f.motionRoleConfidence, NaN))),
    });
  }
  /*
   * Preserve exact visual changes from the analyzer timeline.
   *
   * These become editorial opportunities, not automatic switches.
   */
  type VisualMetric = {
    timelineTime: number;
    sceneChange: number;
    motionDelta: number;
  };

  type VisualEditMoment = {
    time: number;
    type: "scene-change" | "motion-shift";
    strength: number;
  };

  /*
   * Preserve exact visual changes from the analyzer timeline.
   *
   * These are measured editorial opportunities.
   * They do NOT force FREEOS to cut.
   */
  const visualMetrics: VisualMetric[] =
    timeline
      .map(
        (
          frame: JsonObject,
          index: number
        ): VisualMetric => {
          const previous: JsonObject | undefined =
            index > 0
              ? timeline[index - 1]
              : undefined;

          const sourceTime: number =
            number(
              frame.time,
              NaN
            );

          const sceneChange: number =
            number(
              frame.sceneChange,
              0
            );

          const motion: number =
            number(
              frame.motion,
              0
            );

          const previousMotion: number =
            previous
              ? number(
                  previous.motion,
                  motion
                )
              : motion;

          return {
            timelineTime:
              sourceTime + offset,

            sceneChange,

            motionDelta:
              Math.abs(
                motion -
                previousMotion
              ),
          };
        }
      )
      .filter(
        (
          item: VisualMetric
        ): boolean =>
          Number.isFinite(
            item.timelineTime
          )
      );

  const sceneValues: number[] =
    visualMetrics
      .map(
        (
          item: VisualMetric
        ): number =>
          item.sceneChange
      )
      .filter(
        (
          value: number
        ): boolean =>
          Number.isFinite(value)
      )
      .sort(
        (
          a: number,
          b: number
        ): number =>
          a - b
      );

  const motionValues: number[] =
    visualMetrics
      .map(
        (
          item: VisualMetric
        ): number =>
          item.motionDelta
      )
      .filter(
        (
          value: number
        ): boolean =>
          Number.isFinite(value)
      )
      .sort(
        (
          a: number,
          b: number
        ): number =>
          a - b
      );

  const percentileValue = (
    values: number[],
    percentile: number
  ): number => {
    if (!values.length) {
      return 0;
    }

    const index: number =
      Math.max(
        0,
        Math.min(
          values.length - 1,
          Math.floor(
            (values.length - 1) *
            percentile
          )
        )
      );

    return values[index];
  };

  const sceneThreshold: number =
    Math.max(
      0.08,
      percentileValue(
        sceneValues,
        0.88
      )
    );

  const motionThreshold: number =
    Math.max(
      0.03,
      percentileValue(
        motionValues,
        0.90
      )
    );

  const visualEditMoments: VisualEditMoment[] =
    visualMetrics
      .flatMap(
        (
          item: VisualMetric
        ): VisualEditMoment[] => {
          const moments: VisualEditMoment[] = [];

          if (
            item.sceneChange >=
            sceneThreshold
          ) {
            moments.push({
              time:
                Number(
                  item.timelineTime.toFixed(3)
                ),

              type:
                "scene-change",

              strength:
                item.sceneChange,
            });
          }

          if (
            item.motionDelta >=
            motionThreshold
          ) {
            moments.push({
              time:
                Number(
                  item.timelineTime.toFixed(3)
                ),

              type:
                "motion-shift",

              strength:
                item.motionDelta,
            });
          }

          return moments;
        }
      )
      .sort(
        (
          a: VisualEditMoment,
          b: VisualEditMoment
        ): number =>
          b.strength -
          a.strength
      )
      .slice(
        0,
        128
      )
      .sort(
        (
          a: VisualEditMoment,
          b: VisualEditMoment
        ): number =>
          a.time -
          b.time
      );

  return {
    id: input.id,
    timelineOffsetSeconds: offset,
    timelineAvailableStart: offset,
    timelineAvailableEnd: offset + duration,
    durationSeconds: v.durationSeconds,
    width: v.width,
    height: v.height,
    fps: v.fps,
    summary: v.summary,
    sceneChanges:
      Array.isArray(v.sceneChanges)
        ? (v.sceneChanges as unknown[]).slice(0, 100)
        : [],
    qualityFlags: v.qualityFlags,
    analysisVersion: v.analysisVersion,
    windows,
    stateIntervals,
    sampleCadence,
    openingMeasurements,
    editMoments: visualEditMoments,
  };
}
