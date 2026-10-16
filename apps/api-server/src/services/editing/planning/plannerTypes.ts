import type { CreativeIntent } from "../evidence/evidenceRefs";
export type JsonObject = Record<string, unknown>;

export interface EditingPlannerClipInput {
  id: string;
  path: string;
  timelineOffsetSeconds?: number;
  exclude?: boolean;
}

export interface EditingPlannerRequest {
  audioPath: string;
  clips: EditingPlannerClipInput[];
  durationSeconds?: number;
  project?: string;
  sequence?: string;
  userIntent?: string;
  ownerPreferences?: string[];
  sampleFps?: number;
}

export interface EditingDecision {
  start: number;
  end: number;
  clipId: string;
  action: "cut" | "hold" | "punch-in";
  confidence: number;
  rationale: string;
  creativeIntent?: CreativeIntent;
  evidenceRefs?: string[];
}

export interface EditingPlan {
  version: string;
  durationSeconds: number;
  creativeSummary: string;
  decisions: EditingDecision[];
  cautions: string[];
  evidence: {
    audioAnalysisVersion?: string;
    videoAnalysisVersions: Record<string, string | undefined>;
    editingKnowledgeUnits?: number;
    editingKnowledgeGap?: boolean;
    plannerMode?: string;
    cameraProfileCount?: number;
    assemblyReviewApplied?: boolean;
    assemblyReviewFailure?: string;
    assemblyBoundaryPrunes?: number;
    projectClassification?: { primary: string; secondary: string[] };
    selectedAcademyCompetencies?: string[];
    editorialFindings?: { code: string; severity: string; start: number; end: number; evidence: string }[];
    telemetry?: { modelCalls: number; modelElapsedMs: number; mediaCacheHits: number; candidateMomentCount: number; sectionAttempts: number; evidenceRefCount: number; invalidEvidenceRefFailures: number; nonLocalEvidenceRefFailures: number; validationFailures: Record<string, number>; repairAttemptsByCategory: Record<string, number>; criticFindings: string[]; repairs: number; finalDecisionCount: number; totalPlanningMs: number; initialSelection?: { openingMode: "initial-selection"; timelineStart: number; openingEvidenceWindowStart: number; openingEvidenceWindowEnd: number; availableOpeningClips: string[]; openingEvidenceCountsByClip: Record<string, number>; selectedClipId: string; selectedEvidenceRefs: string[] } };
  };
}

export interface CreativeBrief {
  creativeSummary: string;
  principles: string[];
  cautions: string[];
}
export interface CameraProfile {
  clipId: string;
  shotCharacter: string;
  framingCharacter: string;
  motionCharacter: string;
  subjectVisibility: string;
  strengths: string[];
  cautions: string[];
  confidence: number;
}

