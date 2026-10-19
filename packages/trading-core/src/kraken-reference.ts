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

  async trades(fromMs: number, toMs = Date.now(), count = 1000): Promise<PricePoint[]> {
    const url = new URL("/0/public/PostTrade", this.baseUrl);
    url.searchParams.set("symbol", "BTC/USD");
    url.searchParams.set("from_ts", new Date(fromMs).toISOString());
    url.searchParams.set("to_ts", new Date(toMs).toISOString());
    url.searchParams.set("count", String(Math.max(1, Math.min(1000, count))));

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

  async openingProxyTwap(intervalStartMs: number): Promise<number> {
    const points = await this.trades(intervalStartMs - 75_000, intervalStartMs, 1000);
    return perSecondTwap(points, intervalStartMs - 60_000, intervalStartMs);
  }

  async recent(windowSeconds = 180, nowMs = Date.now()): Promise<PricePoint[]> {
    return this.trades(nowMs - windowSeconds * 1000, nowMs, 1000);
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
