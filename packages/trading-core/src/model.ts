import { latestPrice, resampleLast } from "./kraken-reference";
import type { PricePoint, ProbabilitySnapshot } from "./types";

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

// Abramowitz-Stegun style approximation; plenty accurate for a trading probability gate.
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

export function estimateSigmaPerSqrtSecond(points: PricePoint[], nowMs = Date.now()): { sigma: number; sampleCount: number } {
  const start = Math.max(points[0]?.ts ?? nowMs, nowMs - 120_000);
  const sampled = resampleLast(points, start, nowMs, 1000);
  const returns: number[] = [];
  for (let i = 1; i < sampled.length; i++) {
    const a = sampled[i - 1].price;
    const b = sampled[i].price;
    if (a > 0 && b > 0) returns.push(Math.log(b / a));
  }

  // A tiny floor prevents false certainty in unusually quiet or sparse samples.
  return { sigma: Math.max(1e-6, standardDeviation(returns)), sampleCount: returns.length };
}

export function btc15mProbability(
  proxyOpenTwap: number,
  recentPoints: PricePoint[],
  marketEndMs: number,
  nowMs = Date.now(),
): ProbabilitySnapshot {
  if (!(proxyOpenTwap > 0)) throw new Error("BTC proxy opening TWAP must be positive.");
  const proxyCurrent = latestPrice(recentPoints);
  const remainingSeconds = Math.max(1, (marketEndMs - nowMs) / 1000);
  const { sigma, sampleCount } = estimateSigmaPerSqrtSecond(recentPoints, nowMs);
  const logDistance = Math.log(proxyCurrent / proxyOpenTwap);

  // V1 assumes zero future drift. It asks: given today's distance from the opening
  // proxy and recent one-second volatility, how likely is the final price to stay
  // above the opening proxy? Polymarket US settles on a 60-second BRTI average, so
  // calibration from resolved paper trades is required before live use.
  const z = logDistance / (sigma * Math.sqrt(remainingSeconds));
  const pUp = Math.min(0.98, Math.max(0.02, normalCdf(z)));

  return {
    pUp,
    pDown: 1 - pUp,
    proxyOpenTwap,
    proxyCurrent,
    logDistance,
    sigmaPerSqrtSecond: sigma,
    remainingSeconds,
    sampleCount,
  };
}
