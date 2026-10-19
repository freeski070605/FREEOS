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

export function decideTrade(snapshot: TradingSnapshot, config: TradingRiskConfig, state: RiskState): StrategyDecision {
  if (state.alreadyTradedEvent) return { action: "PASS", reason: "One-position-per-event guard is active." };
  if (state.realizedPnlTodayUsd <= -Math.abs(config.maxDailyLossUsd)) {
    return { action: "PASS", reason: "Daily paper-loss circuit breaker is active." };
  }
  if (state.consecutiveLosses >= config.maxConsecutiveLosses) {
    return { action: "PASS", reason: "Consecutive-loss circuit breaker is active." };
  }
  if (snapshot.probability.remainingSeconds < config.minSecondsToExpiry) {
    return { action: "PASS", reason: "Too close to market expiry for a new position." };
  }

  const candidates = (["UP", "DOWN"] as const).flatMap(side => {
    const quote = side === "UP" ? snapshot.up : snapshot.down;
    const probability = side === "UP" ? snapshot.probability.pUp : snapshot.probability.pDown;
    const ask = quote.bestAsk;
    if (ask === null || ask <= 0 || ask >= 1) return [];
    const sideSpread = spread(snapshot, side);
    if (sideSpread === null || sideSpread > config.maxSpread) return [];
    const executablePrice = effectiveBuyPrice(ask, config);
    const rawEdge = probability - ask;
    const adjustedEdge = probability - executablePrice;
    return [{ side, quote, probability, ask, executablePrice, rawEdge, adjustedEdge, sideSpread }];
  });

  if (!candidates.length) return { action: "PASS", reason: "No side has a tradable BBO inside the spread limit." };
  candidates.sort((a, b) => b.adjustedEdge - a.adjustedEdge);
  const best = candidates[0];

  if (best.adjustedEdge < config.minAdjustedEdge) {
    return {
      action: "PASS",
      reason: `Best adjusted edge ${(best.adjustedEdge * 100).toFixed(2)}% is below ${(config.minAdjustedEdge * 100).toFixed(2)}%.`,
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
    notionalUsd: config.maxNotionalUsd,
    reason: `${best.side} has ${(best.adjustedEdge * 100).toFixed(2)}% modeled edge after configured friction/slippage.`,
  };
}
