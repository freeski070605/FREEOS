import type { Btc15mEvent, MarketQuote, OutcomeMarket } from "./types";

interface Amount {
  value: string;
  currency?: string;
}

interface ApiMarket extends OutcomeMarket {}

interface ApiEvent {
  id: number;
  slug: string;
  title: string;
  startTime?: string;
  endTime?: string;
  active: boolean;
  closed: boolean;
  markets?: ApiMarket[];
}

interface EventResponse { event: ApiEvent }
interface EventsResponse { events: ApiEvent[] }
interface BboResponse {
  marketData: {
    marketSlug: string;
    bestBid?: Amount | null;
    bestAsk?: Amount | null;
    lastTradePx?: Amount | null;
    bidDepth?: number;
    askDepth?: number;
  };
}
interface SettlementResponse { slug: string; settlement: number }

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function amount(value?: Amount | null): number | null {
  if (!value) return null;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalFinite(value?: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function utcEventSlug(startMs: number): string {
  const date = new Date(startMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `btc-updown-15m-${yyyy}-${mm}-${dd}-${hh}${min}z`;
}

function outcomeMatch(markets: ApiMarket[], wanted: "up" | "down"): ApiMarket | undefined {
  return markets.find(market => market.outcome?.trim().toLowerCase() === wanted)
    ?? markets.find(market => market.title?.trim().toLowerCase() === wanted)
    ?? markets.find(market => market.title?.toLowerCase().includes(wanted));
}

export class PolymarketUSPublicClient {
  constructor(
    private readonly baseUrl = "https://gateway.polymarket.us",
    private readonly timeoutMs = 8_000,
  ) {}

  private async getJson<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "FREEOS-Trading-Core/0.1" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Polymarket US ${response.status} for ${url.pathname}`);
    return await response.json() as T;
  }

  async eventBySlug(slug: string): Promise<ApiEvent> {
    const response = await this.getJson<EventResponse>(`/v1/events/slug/${encodeURIComponent(slug)}`);
    return response.event;
  }

  async activeBtc15mEvents(nowMs = Date.now()): Promise<ApiEvent[]> {
    const start = Math.floor(nowMs / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS;
    const response = await this.getJson<EventsResponse>("/v1/events", {
      active: true,
      closed: false,
      limit: 100,
      startTimeMin: new Date(start - FIFTEEN_MINUTES_MS).toISOString(),
      startTimeMax: new Date(start + 2 * FIFTEEN_MINUTES_MS).toISOString(),
    });
    return response.events.filter(event => event.title.toLowerCase().includes("btc up or down 15m"));
  }

  async discoverCurrentBtc15m(nowMs = Date.now()): Promise<Btc15mEvent> {
    const intervalStart = Math.floor(nowMs / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS;
    const intervalEnd = intervalStart + FIFTEEN_MINUTES_MS;
    const expectedSlug = utcEventSlug(intervalStart);

    let event: ApiEvent | undefined;
    try {
      event = await this.eventBySlug(expectedSlug);
    } catch {
      const candidates = await this.activeBtc15mEvents(nowMs);
      event = candidates.find(candidate => {
        const start = candidate.startTime ? Date.parse(candidate.startTime) : NaN;
        const end = candidate.endTime ? Date.parse(candidate.endTime) : NaN;
        return Number.isFinite(start) && Number.isFinite(end) && nowMs >= start && nowMs < end;
      }) ?? candidates.find(candidate => candidate.slug === expectedSlug);
    }

    if (!event) throw new Error(`No active BTC 15m event found for ${new Date(nowMs).toISOString()}.`);
    const markets = event.markets ?? [];
    const upMarket = outcomeMatch(markets, "up");
    const downMarket = outcomeMatch(markets, "down");
    if (!upMarket || !downMarket) {
      throw new Error(`BTC 15m event ${event.slug} is missing explicit Up/Down markets.`);
    }

    return {
      id: event.id,
      slug: event.slug,
      title: event.title,
      startTime: event.startTime ?? new Date(intervalStart).toISOString(),
      endTime: event.endTime ?? new Date(intervalEnd).toISOString(),
      upMarket,
      downMarket,
    };
  }

  async bbo(marketSlug: string): Promise<MarketQuote> {
    const response = await this.getJson<BboResponse>(`/v1/markets/${encodeURIComponent(marketSlug)}/bbo`);
    const data = response.marketData;
    return {
      marketSlug: data.marketSlug || marketSlug,
      bestBid: amount(data.bestBid),
      bestAsk: amount(data.bestAsk),
      lastTrade: amount(data.lastTradePx),
      bidDepth: optionalFinite(data.bidDepth),
      askDepth: optionalFinite(data.askDepth),
      observedAt: new Date().toISOString(),
    };
  }

  async settlement(marketSlug: string): Promise<number> {
    const response = await this.getJson<SettlementResponse>(`/v1/markets/${encodeURIComponent(marketSlug)}/settlement`);
    if (!Number.isFinite(response.settlement)) throw new Error(`Invalid settlement for ${marketSlug}.`);
    return response.settlement;
  }
}

export { FIFTEEN_MINUTES_MS, utcEventSlug };
