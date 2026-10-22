import type { StrategyDecision, TradingRiskConfig, TradingSnapshot, TradeSide } from "./types";

export interface RiskState {
  realizedPnlTodayUsd: number;
  consecutiveLosses: number;
  alreadyTradedEvent: boolean;
}

function effectiveBuyPrice(ask: number, config: TradingRiskConfig): number {
  const friction = ask * (config.frictionBps / 10_000);
  return Math.min(0.9999, ask + config.slippage + friction);
}

function spread(snapshot: TradingSnapshot, side: TradeSide): number | null {
  const quote = side === "UP" ? snapshot.up : snapshot.down;
  if (quote.bestAsk === null || quote.bestBid === null) return null;
  return Math.max(0, quote.bestAsk - quote.bestBid);
}

function modeledExpectedRoi(probability: number, executablePrice: number): number {
  // A winning binary share settles at $1. For $1 of stake, expected payout is p / price.
  // Expected ROI is therefore (p / price) - 1, before any unmodeled live execution costs.
  return probability / executablePrice - 1;
}

export function decideTrade(snapshot: TradingSnapshot, config: TradingRiskConfig, state: RiskState): StrategyDecision {
  if (state.alreadyTradedEvent) return { action: "PASS", reason: "One-position-per-event guard is active." };
  if (state.realizedPnlTodayUsd <= -Math.abs(config.maxDailyLossUsd)) {
    return { action: "PASS", reason: "Daily paper-loss circuit breaker is active." };
  }
  if (state.consecutiveLosses >= config.maxConsecutiveLosses) {
    return { action: "PASS", reason: "Consecutive-loss circuit breaker is active." };
  }

  const minSecondsToExpiry = Number.isFinite(config.minSecondsToExpiry) ? config.minSecondsToExpiry : 0;
  const maxSecondsToExpiry = Number.isFinite(config.maxSecondsToExpiry) ? config.maxSecondsToExpiry : Number.POSITIVE_INFINITY;
  const minExecutablePrice = Number.isFinite(config.minExecutablePrice) ? config.minExecutablePrice : 0;
  const minExpectedRoi = Number.isFinite(config.minExpectedRoi) ? config.minExpectedRoi : 0;

  if (snapshot.probability.remainingSeconds < minSecondsToExpiry) {
    return { action: "PASS", reason: "Too close to market expiry for a new position." };
  }
  if (snapshot.probability.remainingSeconds > maxSecondsToExpiry) {
    return {
      action: "PASS",
      reason: `Waiting for late-entry window; ${snapshot.probability.remainingSeconds.toFixed(1)}s remain and max is ${maxSecondsToExpiry.toFixed(1)}s.`,
    };
  }

  const candidates = (["UP", "DOWN"] as const).flatMap(side => {
    const quote = side === "UP" ? snapshot.up : snapshot.down;
    const probability = side === "UP" ? snapshot.probability.pUp : snapshot.probability.pDown;
    const ask = quote.bestAsk;
    if (ask === null || ask <= 0 || ask >= 1) return [];
    const sideSpread = spread(snapshot, side);
    if (sideSpread === null || sideSpread > config.maxSpread) return [];
    const executablePrice = effectiveBuyPrice(ask, config);
    if (executablePrice < minExecutablePrice) return [];
    const rawEdge = probability - ask;
    const adjustedEdge = probability - executablePrice;
    const expectedRoi = modeledExpectedRoi(probability, executablePrice);
    return [{ side, quote, probability, ask, executablePrice, rawEdge, adjustedEdge, expectedRoi, sideSpread }];
  });

  if (!candidates.length) {
    return {
      action: "PASS",
      reason: `No side has a tradable BBO inside the spread limit and minimum executable price ${(minExecutablePrice * 100).toFixed(0)}c.`,
    };
  }

  // Rank by modeled expected dollars first, then probability edge as a tie-breaker.
  candidates.sort((a, b) => b.expectedRoi - a.expectedRoi || b.adjustedEdge - a.adjustedEdge);
  const best = candidates[0];

  if (best.adjustedEdge < config.minAdjustedEdge) {
    return {
      action: "PASS",
      expectedRoi: best.expectedRoi,
      reason: `Best adjusted edge ${(best.adjustedEdge * 100).toFixed(2)}% is below ${(config.minAdjustedEdge * 100).toFixed(2)}%.`,
    };
  }

  if (best.expectedRoi < minExpectedRoi) {
    return {
      action: "PASS",
      expectedRoi: best.expectedRoi,
      reason: `Best modeled expected ROI ${(best.expectedRoi * 100).toFixed(2)}% is below ${(minExpectedRoi * 100).toFixed(2)}%.`,
    };
  }

  return {
    action: "BUY",
    side: best.side,
    marketSlug: best.quote.marketSlug,
    modelProbability: best.probability,
    executablePrice: best.executablePrice,
    rawEdge: best.rawEdge,
    adjustedEdge: best.adjustedEdge,
    expectedRoi: best.expectedRoi,
    notionalUsd: config.maxNotionalUsd,
    reason: `${best.side} has ${(best.adjustedEdge * 100).toFixed(2)}% modeled edge and ${(best.expectedRoi * 100).toFixed(2)}% modeled expected ROI after configured friction/slippage.`,
  };
}
