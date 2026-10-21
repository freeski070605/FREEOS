import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EventOutcomeRecord, ObservationRecord, TradeSide } from "./types";

interface ObservationEnvelope { type: "OBSERVATION"; observation: ObservationRecord }
interface OutcomeEnvelope { type: "EVENT_OUTCOME"; outcome: EventOutcomeRecord }
type ObservationFileRecord = ObservationEnvelope | OutcomeEnvelope;

export type ReplaySideMode = "BOTH" | "UP" | "DOWN";

export interface ReplayConfig {
  label: string;
  minSecondsToExpiry: number;
  maxSecondsToExpiry: number;
  minExecutablePrice: number;
  maxExecutablePrice: number;
  minAdjustedEdge: number;
  maxSpread: number;
  frictionBps: number;
  slippage: number;
  notionalUsd: number;
  sideMode: ReplaySideMode;
}

export interface ReplayTrade {
  eventSlug: string;
  observedAt: string;
  secondsLeft: number;
  side: TradeSide;
  fillPrice: number;
  modelProbability: number;
  adjustedEdge: number;
  settlement: number;
  pnlUsd: number;
}

export interface ReplayStats {
  events: number;
  trades: number;
  wins: number;
  losses: number;
  pushes: number;
  totalNotionalUsd: number;
  totalPnlUsd: number;
  roi: number | null;
  winRate: number | null;
  avgFillPrice: number | null;
  avgAdjustedEdge: number | null;
  upTrades: number;
  downTrades: number;
}

export interface CandidateReplayResult {
  config: ReplayConfig;
  train: ReplayStats;
  validation: ReplayStats;
  all: ReplayStats;
}

export interface BacktestReport {
  generatedAt: string;
  methodology: string;
  resolvedEvents: number;
  split: {
    trainEvents: number;
    validationEvents: number;
    trainThrough: string | null;
    validationFrom: string | null;
  };
  currentV2: CandidateReplayResult;
  candidateCount: number;
  topCandidatesSelectedOnTrainOnly: CandidateReplayResult[];
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

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function effectiveBuyPrice(ask: number, config: ReplayConfig): number {
  const friction = ask * (config.frictionBps / 10_000);
  return Math.min(0.9999, ask + config.slippage + friction);
}

function allowedSides(mode: ReplaySideMode): TradeSide[] {
  if (mode === "UP") return ["UP"];
  if (mode === "DOWN") return ["DOWN"];
  return ["UP", "DOWN"];
}

function summarize(trades: ReplayTrade[], eventCount: number, notionalUsd: number): ReplayStats {
  const wins = trades.filter(trade => trade.pnlUsd > 1e-9).length;
  const losses = trades.filter(trade => trade.pnlUsd < -1e-9).length;
  const pushes = trades.length - wins - losses;
  const totalNotionalUsd = trades.length * notionalUsd;
  const totalPnlUsd = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  return {
    events: eventCount,
    trades: trades.length,
    wins,
    losses,
    pushes,
    totalNotionalUsd: round(totalNotionalUsd, 2) ?? 0,
    totalPnlUsd: round(totalPnlUsd, 2) ?? 0,
    roi: totalNotionalUsd > 0 ? round(totalPnlUsd / totalNotionalUsd) : null,
    winRate: trades.length ? round(wins / trades.length) : null,
    avgFillPrice: round(mean(trades.map(trade => trade.fillPrice))),
    avgAdjustedEdge: round(mean(trades.map(trade => trade.adjustedEdge))),
    upTrades: trades.filter(trade => trade.side === "UP").length,
    downTrades: trades.filter(trade => trade.side === "DOWN").length,
  };
}

function replay(
  config: ReplayConfig,
  observationsByEvent: Map<string, ObservationRecord[]>,
  outcomeByEvent: Map<string, EventOutcomeRecord>,
  eventSlugs: string[],
): ReplayStats {
  const trades: ReplayTrade[] = [];

  for (const eventSlug of eventSlugs) {
    const outcome = outcomeByEvent.get(eventSlug);
    if (!outcome) continue;
    const observations = observationsByEvent.get(eventSlug) ?? [];

    for (const observation of observations) {
      if (observation.secondsLeft < config.minSecondsToExpiry || observation.secondsLeft > config.maxSecondsToExpiry) continue;

      const candidates = allowedSides(config.sideMode).flatMap(side => {
        const bid = side === "UP" ? observation.upBid : observation.downBid;
        const ask = side === "UP" ? observation.upAsk : observation.downAsk;
        const probability = side === "UP" ? observation.pUp : observation.pDown;
        if (bid === null || ask === null || ask <= 0 || ask >= 1) return [];
        const spread = Math.max(0, ask - bid);
        if (spread > config.maxSpread) return [];
        const fillPrice = effectiveBuyPrice(ask, config);
        if (fillPrice < config.minExecutablePrice || fillPrice > config.maxExecutablePrice) return [];
        const adjustedEdge = probability - fillPrice;
        if (adjustedEdge < config.minAdjustedEdge) return [];
        return [{ side, fillPrice, probability, adjustedEdge }];
      });

      if (!candidates.length) continue;
      candidates.sort((a, b) => b.adjustedEdge - a.adjustedEdge);
      const best = candidates[0];
      const settlement = best.side === "UP" ? outcome.upSettlement : outcome.downSettlement;
      const shares = config.notionalUsd / best.fillPrice;
      const pnlUsd = shares * settlement - config.notionalUsd;
      trades.push({
        eventSlug,
        observedAt: observation.observedAt,
        secondsLeft: observation.secondsLeft,
        side: best.side,
        fillPrice: best.fillPrice,
        modelProbability: best.probability,
        adjustedEdge: best.adjustedEdge,
        settlement,
        pnlUsd,
      });
      break;
    }
  }

  return summarize(trades, eventSlugs.length, config.notionalUsd);
}

function configLabel(maxSeconds: number, minPrice: number, maxPrice: number, edge: number, sideMode: ReplaySideMode): string {
  const price = `${Math.round(minPrice * 100)}-${Math.round(maxPrice * 100)}c`;
  return `${sideMode} ${Math.round(maxSeconds / 60)}m->75s ${price} edge>=${Math.round(edge * 1000) / 10}%`;
}

function candidateGrid(): ReplayConfig[] {
  const maxSeconds = [360, 300, 240, 180, 120];
  const priceBands = [
    [0.40, 0.60],
    [0.40, 0.80],
    [0.40, 0.9999],
    [0.60, 0.80],
    [0.80, 0.9999],
  ] as const;
  const edges = [0.05, 0.075, 0.10, 0.125];
  const sideModes: ReplaySideMode[] = ["BOTH", "UP", "DOWN"];
  const configs: ReplayConfig[] = [];

  for (const max of maxSeconds) {
    for (const [minPrice, maxPrice] of priceBands) {
      for (const edge of edges) {
        for (const sideMode of sideModes) {
          configs.push({
            label: configLabel(max, minPrice, maxPrice, edge, sideMode),
            minSecondsToExpiry: 75,
            maxSecondsToExpiry: max,
            minExecutablePrice: minPrice,
            maxExecutablePrice: maxPrice,
            minAdjustedEdge: edge,
            maxSpread: 0.06,
            frictionBps: 75,
            slippage: 0.005,
            notionalUsd: 5,
            sideMode,
          });
        }
      }
    }
  }
  return configs;
}

export function buildBacktestReport(dataDir: string): BacktestReport {
  const directory = resolve(dataDir);
  const records = readJsonl<ObservationFileRecord>(join(directory, "btc15m-observations.jsonl"));
  const observations = records
    .filter((record): record is ObservationEnvelope => record.type === "OBSERVATION")
    .map(record => record.observation);
  const outcomes = records
    .filter((record): record is OutcomeEnvelope => record.type === "EVENT_OUTCOME")
    .map(record => record.outcome)
    .sort((a, b) => Date.parse(a.eventEndTime) - Date.parse(b.eventEndTime));

  const outcomeByEvent = new Map(outcomes.map(outcome => [outcome.eventSlug, outcome]));
  const observationsByEvent = new Map<string, ObservationRecord[]>();
  for (const observation of observations) {
    if (!outcomeByEvent.has(observation.eventSlug)) continue;
    const rows = observationsByEvent.get(observation.eventSlug) ?? [];
    rows.push(observation);
    observationsByEvent.set(observation.eventSlug, rows);
  }
  for (const rows of observationsByEvent.values()) {
    rows.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }

  const eventSlugs = outcomes.map(outcome => outcome.eventSlug);
  const splitIndex = Math.max(1, Math.min(eventSlugs.length - 1, Math.floor(eventSlugs.length * 0.70)));
  const trainSlugs = eventSlugs.slice(0, splitIndex);
  const validationSlugs = eventSlugs.slice(splitIndex);

  const currentV2Config: ReplayConfig = {
    label: "current-v2-late-window-value",
    minSecondsToExpiry: 75,
    maxSecondsToExpiry: 360,
    minExecutablePrice: 0.40,
    maxExecutablePrice: 0.9999,
    minAdjustedEdge: 0.05,
    maxSpread: 0.06,
    frictionBps: 75,
    slippage: 0.005,
    notionalUsd: 5,
    sideMode: "BOTH",
  };

  const evaluate = (config: ReplayConfig): CandidateReplayResult => ({
    config,
    train: replay(config, observationsByEvent, outcomeByEvent, trainSlugs),
    validation: replay(config, observationsByEvent, outcomeByEvent, validationSlugs),
    all: replay(config, observationsByEvent, outcomeByEvent, eventSlugs),
  });

  const configs = candidateGrid();
  const evaluated = configs.map(evaluate);
  const minimumTrainTrades = Math.max(6, Math.floor(trainSlugs.length * 0.20));
  const topCandidates = evaluated
    .filter(result => result.train.trades >= minimumTrainTrades)
    .sort((a, b) => {
      if (b.train.totalPnlUsd !== a.train.totalPnlUsd) return b.train.totalPnlUsd - a.train.totalPnlUsd;
      return (b.train.roi ?? -Infinity) - (a.train.roi ?? -Infinity);
    })
    .slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    methodology: "Chronological 70/30 split. Candidate rules are ranked only on the older 70% training events; the newer 30% validation results are displayed but never used for ranking. Each replay takes the first qualifying observation in an event and allows at most one $5 paper position per event. This is research on a small sample, not evidence of live profitability.",
    resolvedEvents: eventSlugs.length,
    split: {
      trainEvents: trainSlugs.length,
      validationEvents: validationSlugs.length,
      trainThrough: trainSlugs.length ? outcomeByEvent.get(trainSlugs.at(-1)!)?.eventEndTime ?? null : null,
      validationFrom: validationSlugs.length ? outcomeByEvent.get(validationSlugs[0])?.eventEndTime ?? null : null,
    },
    currentV2: evaluate(currentV2Config),
    candidateCount: configs.length,
    topCandidatesSelectedOnTrainOnly: topCandidates,
  };
}
