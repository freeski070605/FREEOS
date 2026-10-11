export interface FaceBox { x:number; y:number; w:number; h:number; areaRatio:number; centerX:number; centerY:number; edgeMargin:number }
export interface VideoFrameEvidence { time:number; sharpness:number; brightness:number; contrast:number; underexposedFraction:number; overexposedFraction:number; motion:number; sceneChange:number; faceCount:number; largestFace:FaceBox|null }
export interface NumericStats { mean:number|null; p10:number|null; p50:number|null; p90:number|null }
export interface VideoQualityFlag { start:number; end:number; kind:"blur"|"underexposed"|"overexposed"; severity:number }
export interface VideoAnalysis {
  path:string; durationSeconds:number; width:number; height:number; fps:number; sampleFps:number; framesAnalyzed:number;
  timeline:VideoFrameEvidence[];
  sceneChanges:Array<{time:number; strength:number}>;
  summary:{ sharpness:NumericStats; brightness:NumericStats; motion:NumericStats; facePresenceRatio:number; multiFaceRatio:number; primaryFaceArea:NumericStats; centeredFaceRatio:number; faceEdgeRiskRatio:number };
  qualityFlags:VideoQualityFlag[];
  analysisVersion:string;
}
export function parseVideoAnalysis(value:unknown):VideoAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Video analyzer returned invalid JSON.");
  const v=value as Record<string,unknown>;
  if (typeof v.path!=="string" || typeof v.analysisVersion!=="string") throw new Error("Video analyzer metadata is invalid.");
  for (const key of ["durationSeconds","width","height","fps","sampleFps","framesAnalyzed"] as const) if (typeof v[key]!=="number" || !Number.isFinite(v[key] as number)) throw new Error(`Video analyzer field ${key} is invalid.`);
  if (!Array.isArray(v.timeline) || !Array.isArray(v.sceneChanges) || !Array.isArray(v.qualityFlags) || !v.summary || typeof v.summary!=="object") throw new Error("Video analyzer evidence is incomplete.");
  return value as VideoAnalysis;
}
