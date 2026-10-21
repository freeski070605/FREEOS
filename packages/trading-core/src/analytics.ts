import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EventOutcomeRecord, ObservationRecord, PaperPosition, SettledPaperPosition, TradeSide } from "./types";

interface ObservationEnvelope { type: "OBSERVATION"; observation: ObservationRecord }
interface OutcomeEnvelope { type: "EVENT_OUTCOME"; outcome: EventOutcomeRecord }
interface OpenEnvelope { type: "PAPER_OPEN"; position: PaperPosition }
interface SettleEnvelope { type: "PAPER_SETTLE"; position: SettledPaperPosition }

type ObservationFileRecord = ObservationEnvelope | OutcomeEnvelope;
type LedgerFileRecord = OpenEnvelope | SettleEnvelope;

export interface CalibrationStats {
  n: number;
  brier: number | null;
  logLoss: number | null;
  directionalAccuracy: number | null;
  marketBrier: number | null;
  avgAbsModelMarketGap: number | null;
}

export interface TimeBucketStats extends CalibrationStats {
  bucket: string;
}

export interface PaperPerformanceStats {
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  totalNotionalUsd: number;
  totalPnlUsd: number;
  roi: number | null;
  winRate: number | null;
  avgFillPrice: number | null;
  avgModelProbability: number | null;
  avgAdjustedEdge: number | null;
  modelExpectedPnlUsd: number;
  modelExpectedRoi: number | null;
}

export interface PaperBucketStats extends PaperPerformanceStats {
  bucket: string;
}

export interface PaperSideStats extends PaperPerformanceStats {
  side: TradeSide;
}

export interface TradingAnalyticsSummary {
  generatedAt: string;
  latestObservationAt: string | null;
  observationAgeSeconds: number | null;
  observations: number;
  eventsObserved: number;
  eventsResolved: number;
  resolvedObservations: number;
  overall: CalibrationStats;
  byTimeRemaining: TimeBucketStats[];
  paper: PaperPerformanceStats & {
    opened: number;
    pending: number;
    pendingWithKnownOutcome: number;
    pendingWithoutKnownOutcome: number;
    byEntryTimeRemaining: PaperBucketStats[];
    byEntryPrice: PaperBucketStats[];
    bySide: PaperSideStats[];
  };
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try { return [JSON.parse(line) as T]; }
      catch { return []; }
    });
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function bucketFor(secondsLeft: number): string {
  const minutes = Math.max(0, secondsLeft) / 60;
  if (minutes >= 14) return "14-15m";
  if (minutes >= 12) return "12-14m";
  if (minutes >= 10) return "10-12m";
  if (minutes >= 8) return "8-10m";
  if (minutes >= 6) return "6-8m";
  if (minutes >= 4) return "4-6m";
  if (minutes >= 2) return "2-4m";
  return "0-2m";
}

function entryPriceBucket(price: number): string {
  if (price < 0.20) return "<20c";
  if (price < 0.40) return "20-40c";
  if (price < 0.60) return "40-60c";
  if (price < 0.80) return "60-80c";
  return "80c+";
}

const BUCKET_ORDER = ["14-15m", "12-14m", "10-12m", "8-10m", "6-8m", "4-6m", "2-4m", "0-2m"];
const PRICE_BUCKET_ORDER = ["<20c", "20-40c", "40-60c", "60-80c", "80c+"];

function calibration(rows: Array<{ observation: ObservationRecord; outcome: EventOutcomeRecord }>): CalibrationStats {
  const brier: number[] = [];
  const logLoss: number[] = [];
  const accuracy: number[] = [];
  const marketBrier: number[] = [];
  const gaps: number[] = [];

  for (const { observation, outcome } of rows) {
    const y = outcome.upSettlement;
    const p = Math.min(1 - 1e-6, Math.max(1e-6, observation.pUp));
    brier.push((p - y) ** 2);
    logLoss.push(-(y * Math.log(p) + (1 - y) * Math.log(1 - p)));
    accuracy.push((p >= 0.5) === (y >= 0.5) ? 1 : 0);

    if (observation.upMid !== null) {
      marketBrier.push((observation.upMid - y) ** 2);
      gaps.push(Math.abs(observation.pUp - observation.upMid));
    }
  }

  return {
    n: rows.length,
    brier: round(mean(brier)),
    logLoss: round(mean(logLoss)),
    directionalAccuracy: round(mean(accuracy)),
    marketBrier: round(mean(marketBrier)),
    avgAbsModelMarketGap: round(mean(gaps)),
  };
}

function paperPerformance(positions: SettledPaperPosition[]): PaperPerformanceStats {
  const wins = positions.filter(position => position.pnlUsd > 1e-9).length;
  const losses = positions.filter(position => position.pnlUsd < -1e-9).length;
  const pushes = positions.length - wins - losses;
  const totalNotionalUsd = positions.reduce((sum, position) => sum + position.notionalUsd, 0);
  const totalPnlUsd = positions.reduce((sum, position) => sum + position.pnlUsd, 0);
  const modelExpectedPnlUsd = positions.reduce((sum, position) => {
    const expectedPayout = position.shares * position.modelProbability;
    return sum + expectedPayout - position.notionalUsd;
  }, 0);

  return {
    settled: positions.length,
    wins,
    losses,
    pushes,
    totalNotionalUsd: round(totalNotionalUsd, 2) ?? 0,
    totalPnlUsd: round(totalPnlUsd, 2) ?? 0,
    roi: totalNotionalUsd > 0 ? round(totalPnlUsd / totalNotionalUsd) : null,
    winRate: positions.length > 0 ? round(wins / positions.length) : null,
    avgFillPrice: round(mean(positions.map(position => position.fillPrice))),
    avgModelProbability: round(mean(positions.map(position => position.modelProbability))),
    avgAdjustedEdge: round(mean(positions.map(position => position.adjustedEdge))),
    modelExpectedPnlUsd: round(modelExpectedPnlUsd, 2) ?? 0,
    modelExpectedRoi: totalNotionalUsd > 0 ? round(modelExpectedPnlUsd / totalNotionalUsd) : null,
  };
}

function groupPaperByBucket(
  positions: SettledPaperPosition[],
  keys: string[],
  keyFor: (position: SettledPaperPosition) => string,
): PaperBucketStats[] {
  return keys.map(bucket => ({
    bucket,
    ...paperPerformance(positions.filter(position => keyFor(position) === bucket)),
  }));
}

export function buildAnalyticsSummary(dataDir: string): TradingAnalyticsSummary {
  const nowMs = Date.now();
  const directory = resolve(dataDir);
  const observationRecords = readJsonl<ObservationFileRecord>(join(directory, "btc15m-observations.jsonl"));
  const ledgerRecords = readJsonl<LedgerFileRecord>(join(directory, "btc15m-paper-ledger.jsonl"));

  const observations = observationRecords
    .filter((record): record is ObservationEnvelope => record.type === "OBSERVATION")
    .map(record => record.observation);
  const outcomes = observationRecords
    .filter((record): record is OutcomeEnvelope => record.type === "EVENT_OUTCOME")
    .map(record => record.outcome);
  const outcomeByEvent = new Map(outcomes.map(outcome => [outcome.eventSlug, outcome]));
  const resolvedRows = observations.flatMap(observation => {
    const outcome = outcomeByEvent.get(observation.eventSlug);
    return outcome ? [{ observation, outcome }] : [];
  });

  const byBucket = new Map<string, typeof resolvedRows>();
  for (const row of resolvedRows) {
    const bucket = bucketFor(row.observation.secondsLeft);
    const rows = byBucket.get(bucket) ?? [];
    rows.push(row);
    byBucket.set(bucket, rows);
  }

  const opens = ledgerRecords
    .filter((record): record is OpenEnvelope => record.type === "PAPER_OPEN")
    .map(record => record.position);
  const settlements = ledgerRecords
    .filter((record): record is SettleEnvelope => record.type === "PAPER_SETTLE")
    .map(record => record.position);
  const settledIds = new Set(settlements.map(position => position.id));
  const pendingPositions = opens.filter(position => !settledIds.has(position.id));
  const pendingWithKnownOutcome = pendingPositions.filter(position => outcomeByEvent.has(position.eventSlug)).length;
  const pendingWithoutKnownOutcome = pendingPositions.length - pendingWithKnownOutcome;

  const latestObservationAt = observations.length
    ? observations.reduce((latest, observation) => Date.parse(observation.observedAt) > Date.parse(latest) ? observation.observedAt : latest, observations[0].observedAt)
    : null;
  const latestObservationMs = latestObservationAt ? Date.parse(latestObservationAt) : Number.NaN;
  const observationAgeSeconds = Number.isFinite(latestObservationMs)
    ? round(Math.max(0, (nowMs - latestObservationMs) / 1000), 1)
    : null;

  const aggregatePaper = paperPerformance(settlements);
  const byEntryTimeRemaining = groupPaperByBucket(
    settlements,
    BUCKET_ORDER,
    position => {
      const endMs = Date.parse(position.eventEndTime);
      const openedMs = Date.parse(position.openedAt);
      const secondsLeft = Number.isFinite(endMs) && Number.isFinite(openedMs)
        ? Math.max(0, (endMs - openedMs) / 1000)
        : 0;
      return bucketFor(secondsLeft);
    },
  );
  const byEntryPrice = groupPaperByBucket(settlements, PRICE_BUCKET_ORDER, position => entryPriceBucket(position.fillPrice));
  const bySide: PaperSideStats[] = (["UP", "DOWN"] as const).map(side => ({
    side,
    ...paperPerformance(settlements.filter(position => position.side === side)),
  }));

  return {
    generatedAt: new Date(nowMs).toISOString(),
    latestObservationAt,
    observationAgeSeconds,
    observations: observations.length,
    eventsObserved: new Set(observations.map(observation => observation.eventSlug)).size,
    eventsResolved: outcomes.length,
    resolvedObservations: resolvedRows.length,
    overall: calibration(resolvedRows),
    byTimeRemaining: BUCKET_ORDER.map(bucket => ({
      bucket,
      ...calibration(byBucket.get(bucket) ?? []),
    })),
    paper: {
      opened: opens.length,
      ...aggregatePaper,
      pending: pendingPositions.length,
      pendingWithKnownOutcome,
      pendingWithoutKnownOutcome,
      byEntryTimeRemaining,
      byEntryPrice,
      bySide,
    },
  };
}
