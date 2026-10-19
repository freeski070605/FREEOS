import type { PricePoint } from "./types";

interface KrakenTrade {
  price: string;
  trade_ts: string;
  symbol?: string;
}

interface KrakenPostTradeResponse {
  error?: string[];
  result?: {
    trades?: KrakenTrade[];
  };
}

export class KrakenReferenceFeed {
  constructor(
    private readonly baseUrl = "https://api.kraken.com",
    private readonly timeoutMs = 8_000,
  ) {}

  private async queryTrades(options: { fromMs?: number; toMs?: number; count?: number }): Promise<PricePoint[]> {
    const url = new URL("/0/public/PostTrade", this.baseUrl);
    url.searchParams.set("symbol", "BTC/USD");
    if (options.fromMs !== undefined) url.searchParams.set("from_ts", new Date(options.fromMs).toISOString());
    if (options.toMs !== undefined) url.searchParams.set("to_ts", new Date(options.toMs).toISOString());
    url.searchParams.set("count", String(Math.max(1, Math.min(1000, options.count ?? 1000))));

    const response = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "FREEOS-Trading-Core/0.1" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Kraken reference feed returned HTTP ${response.status}.`);
    const payload = await response.json() as KrakenPostTradeResponse;
    if (payload.error?.length) throw new Error(`Kraken reference feed error: ${payload.error.join(", ")}`);

    return (payload.result?.trades ?? [])
      .map(trade => ({ ts: Date.parse(trade.trade_ts), price: Number(trade.price) }))
      .filter(point => Number.isFinite(point.ts) && Number.isFinite(point.price) && point.price > 0)
      .sort((a, b) => a.ts - b.ts);
  }

  async trades(fromMs: number, toMs = Date.now(), count = 1000): Promise<PricePoint[]> {
    return this.queryTrades({ fromMs, toMs, count });
  }

  async openingProxyTwap(intervalStartMs: number): Promise<number> {
    // Chunk the resolution-aligned one-minute opening proxy window so a busy BTC tape cannot
    // silently truncate the minute to Kraken's 1,000-row response limit.
    const points: PricePoint[] = [];
    const windowStart = intervalStartMs - 60_000;
    for (let chunkStart = windowStart; chunkStart < intervalStartMs; chunkStart += 10_000) {
      const chunkEnd = Math.min(intervalStartMs, chunkStart + 10_000);
      points.push(...await this.queryTrades({ fromMs: chunkStart, toMs: chunkEnd, count: 1000 }));
    }
    return perSecondTwap(points, windowStart, intervalStartMs);
  }

  async recent(windowSeconds = 180, nowMs = Date.now()): Promise<PricePoint[]> {
    // With no from_ts Kraken returns the newest slice instead of the first 1,000 rows from a
    // busy multi-minute range. We then trim locally to the requested window.
    const points = await this.queryTrades({ toMs: nowMs, count: 1000 });
    const cutoff = nowMs - windowSeconds * 1000;
    return points.filter(point => point.ts >= cutoff && point.ts <= nowMs);
  }
}

export function resampleLast(points: PricePoint[], startMs: number, endMs: number, stepMs = 1000): PricePoint[] {
  if (!points.length || endMs <= startMs || stepMs <= 0) return [];
  const ordered = [...points].sort((a, b) => a.ts - b.ts);
  const samples: PricePoint[] = [];
  let cursor = 0;
  let last: PricePoint | undefined;

  while (cursor < ordered.length && ordered[cursor].ts <= startMs) {
    last = ordered[cursor++];
  }
  if (!last) last = ordered[0];

  for (let ts = startMs; ts < endMs; ts += stepMs) {
    while (cursor < ordered.length && ordered[cursor].ts <= ts) {
      last = ordered[cursor++];
    }
    if (last) samples.push({ ts, price: last.price });
  }
  return samples;
}

export function perSecondTwap(points: PricePoint[], startMs: number, endMs: number): number {
  const samples = resampleLast(points, startMs, endMs, 1000);
  if (!samples.length) throw new Error("Not enough BTC proxy data to calculate a one-second TWAP.");
  return samples.reduce((sum, point) => sum + point.price, 0) / samples.length;
}

export function latestPrice(points: PricePoint[]): number {
  if (!points.length) throw new Error("No BTC proxy prices available.");
  return points[points.length - 1].price;
}
