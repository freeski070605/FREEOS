import type { JsonObject } from "../planning/plannerTypes";
import { number } from "../shared";
export function sectionEvidence(audio: JsonObject, videos: JsonObject[], start: number, end: number) {
  const audioWindows = Array.isArray(audio.windows) ? audio.windows as JsonObject[] : [];
  const availability = videos.map((video) => ({
    id: video.id,
    start: video.timelineAvailableStart,
    end: video.timelineAvailableEnd,
  })).filter((video) => number(video.end, 0) > start && number(video.start, 0) < end);

  const moments: JsonObject[] = [];
  for (let momentStart = start; momentStart < end; momentStart += 4) {
    const momentEnd = Math.min(end, momentStart + 4);
    const audioWindow = audioWindows.find((w) => number(w.end, 0) > momentStart && number(w.start, 0) < momentEnd);
    const candidates = videos.flatMap((video) => {
      if (number(video.timelineAvailableEnd, 0) <= momentStart || number(video.timelineAvailableStart, 0) >= momentEnd) return [];
      const windows = Array.isArray(video.windows) ? video.windows as JsonObject[] : [];
      const w = windows.find((item) => number(item.timelineEnd, 0) > momentStart && number(item.timelineStart, 0) < momentEnd);
      if (!w) return [];
      return [{
        id: video.id,
        sharpness: w.sharpness,
        brightness: w.brightness,
        motion: w.motion,
        facePresence: w.facePresence,
        multiFacePresence: w.multiFacePresence,
        primaryFaceArea: w.primaryFaceArea,
        sceneChangeMax: w.sceneChangeMax,
        underexposedFraction: w.underexposedFraction,
        overexposedFraction: w.overexposedFraction,
        personPresence: w.personPresence,
        personCountMean: w.personCountMean,
        subjectCountMean: w.subjectCountMean,
        primaryPersonArea: w.primaryPersonArea,
        globalMotion: w.globalMotion,
        localMotion: w.localMotion,
        shotScale: w.shotScale,
        shotScaleConfidence: w.shotScaleConfidence,
        framingRole: w.framingRole,
        framingRoleConfidence: w.framingRoleConfidence,
        motionRole: w.motionRole,
        motionRoleConfidence: w.motionRoleConfidence,
      }];
    });
    moments.push({
      start: Number(momentStart.toFixed(3)),
      end: Number(momentEnd.toFixed(3)),
      audio: audioWindow ? {
        energyMean: audioWindow.energyMean,
        transientCount: audioWindow.transientCount,
        strongestTransient: audioWindow.strongestTransient,
        beatCount: audioWindow.beatCount,
      } : null,
      candidates,
    });
  }

  return { start, end, tempo: audio.tempo, loudness: audio.loudness, availability, moments };
}
