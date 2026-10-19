import { join, resolve } from "node:path";
import { KrakenReferenceFeed } from "./kraken-reference";
import { btc15mProbability } from "./model";
import { ObservationLog } from "./observation-log";
import { PaperLedger } from "./paper-ledger";
import { complementBinaryQuote, PolymarketUSPublicClient } from "./polymarket-us-public";
import { decideTrade } from "./strategy";
import type { Btc15mEvent, EventOutcomeRecord, MarketQuote, PaperPosition, SettledPaperPosition, StrategyDecision, TradingEngineConfig, TradingSnapshot } from "./types";

export interface TradingTickResult {
  snapshot?: TradingSnapshot;
  decision?: StrategyDecision;
  opened?: PaperPosition;
  settled?: SettledPaperPosition;
  resolvedOutcomes?: EventOutcomeRecord[];
  message: string;
}

export function defaultTradingConfig(): TradingEngineConfig {
  const repositoryDataDir = resolve(__dirname, "..", "..", "..", "data");
  const base = process.env.FREEOS_DATA_DIR?.trim() || repositoryDataDir;
  return {
    pollMs: 5_000,
    dataDir: join(base, "trading"),
    risk: {
      // Paper-mode calibration defaults, not recommended live sizing.
      minAdjustedEdge: 0.05,
      maxNotionalUsd: 5,
      maxSpread: 0.06,
      minSecondsToExpiry: 75,
      maxDailyLossUsd: 20,
      maxConsecutiveLosses: 4,
      // Conservative model friction buffer; it is not a claim about Polymarket's fee formula.
      frictionBps: 75,
      slippage: 0.005,
    },
  };
}

export class Btc15mPaperEngine {
  readonly ledger: PaperLedger;
  readonly observations: ObservationLog;
  private cachedEventSlug: string | null = null;
  private cachedOpeningProxyTwap: number | null = null;

  constructor(
    readonly config = defaultTradingConfig(),
    readonly polymarket = new PolymarketUSPublicClient(),
    readonly reference = new KrakenReferenceFeed(),
  ) {
    this.ledger = new PaperLedger(config.dataDir);
    this.observations = new ObservationLog(config.dataDir);
  }

  private async openingProxy(event: Btc15mEvent): Promise<number> {
    if (this.cachedEventSlug === event.slug && this.cachedOpeningProxyTwap !== null) return this.cachedOpeningProxyTwap;
    const startMs = Date.parse(event.startTime);
    if (!Number.isFinite(startMs)) throw new Error(`Invalid event start time for ${event.slug}.`);
    const twap = await this.reference.openingProxyTwap(startMs);
    this.cachedEventSlug = event.slug;
    this.cachedOpeningProxyTwap = twap;
    return twap;
  }

  private async marketQuotes(event: Btc15mEvent): Promise<{ marketStructure: "shared-binary" | "distinct-outcomes"; up: MarketQuote; down: MarketQuote }> {
    if (event.upMarket.slug === event.downMarket.slug) {
      const up = await this.polymarket.bbo(event.upMarket.slug);
      return {
        marketStructure: "shared-binary",
        up,
        down: complementBinaryQuote(up),
      };
    }

    const [up, down] = await Promise.all([
      this.polymarket.bbo(event.upMarket.slug),
      this.polymarket.bbo(event.downMarket.slug),
    ]);
    return { marketStructure: "distinct-outcomes", up, down };
  }

  private async settleOpenIfReady(nowMs: number): Promise<SettledPaperPosition | undefined> {
    const open = this.ledger.openPosition();
    if (!open) return undefined;
    const closeMs = Date.parse(open.eventEndTime);
    if (!Number.isFinite(closeMs) || nowMs < closeMs + 5_000) return undefined;

    // Old paper records created before market-structure tracking cannot be settled safely.
    if (!open.marketStructure) return undefined;

    // The public settlement endpoint may not be ready immediately after close. A failed read
    // is non-fatal and will be retried on the next tick.
    try {
      const rawSettlement = await this.polymarket.settlement(open.marketSlug);
      const sideSettlement = open.marketStructure === "shared-binary" && open.side === "DOWN"
        ? 1 - rawSettlement
        : rawSettlement;
      return this.ledger.settle(open, sideSettlement);
    } catch {
      return undefined;
    }
  }

  private async resolveObservedEventsIfReady(nowMs: number): Promise<EventOutcomeRecord[]> {
    const ready = this.observations.unresolvedEvents(nowMs, 5_000, 4);
    const resolved: EventOutcomeRecord[] = [];

    for (const observation of ready) {
      try {
        let upSettlement: number;
        let downSettlement: number;
        if (observation.marketStructure === "shared-binary") {
          upSettlement = await this.polymarket.settlement(observation.upMarketSlug);
          downSettlement = 1 - upSettlement;
        } else {
          [upSettlement, downSettlement] = await Promise.all([
            this.polymarket.settlement(observation.upMarketSlug),
            this.polymarket.settlement(observation.downMarketSlug),
          ]);
        }

        if (![upSettlement, downSettlement].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) continue;
        const outcome: EventOutcomeRecord = {
          eventSlug: observation.eventSlug,
          eventEndTime: observation.eventEndTime,
          marketStructure: observation.marketStructure,
          upMarketSlug: observation.upMarketSlug,
          downMarketSlug: observation.downMarketSlug,
          resolvedAt: new Date(nowMs).toISOString(),
          upSettlement,
          downSettlement,
        };
        this.observations.appendOutcome(outcome);
        resolved.push(outcome);
      } catch {
        // Settlement publication can lag close. Leave unresolved and retry on a later tick.
      }
    }
    return resolved;
  }

  async tick(nowMs = Date.now()): Promise<TradingTickResult> {
    const [settled, resolvedOutcomes] = await Promise.all([
      this.settleOpenIfReady(nowMs),
      this.resolveObservedEventsIfReady(nowMs),
    ]);
    const event = await this.polymarket.discoverCurrentBtc15m(nowMs);
    const eventEndMs = Date.parse(event.endTime);
    if (!Number.isFinite(eventEndMs)) throw new Error(`Invalid event end time for ${event.slug}.`);

    const [proxyOpenTwap, recentPoints, quotes] = await Promise.all([
      this.openingProxy(event),
      this.reference.recent(180, nowMs),
      this.marketQuotes(event),
    ]);

    const probability = btc15mProbability(proxyOpenTwap, recentPoints, eventEndMs, nowMs);
    const snapshot: TradingSnapshot = {
      event,
      marketStructure: quotes.marketStructure,
      up: quotes.up,
      down: quotes.down,
      probability,
      observedAt: new Date(nowMs).toISOString(),
    };

    if (probability.sampleCount < 30) {
      const decision: StrategyDecision = {
        action: "PASS",
        reason: `Only ${probability.sampleCount} one-second returns available; need at least 30.`,
      };
      this.observations.appendObservation(snapshot, decision);
      return {
        snapshot,
        settled,
        resolvedOutcomes,
        decision,
        message: "Insufficient BTC proxy history for a probability estimate.",
      };
    }

    const state = this.ledger.riskState(event.slug, new Date(nowMs));
    const decision = decideTrade(snapshot, this.config.risk, state);
    this.observations.appendObservation(snapshot, decision);
    const opened = decision.action === "BUY" ? this.ledger.open(decision, event, this.config.risk) : undefined;

    return {
      snapshot,
      decision,
      opened,
      settled,
      resolvedOutcomes,
      message: opened ? `Paper ${opened.side} position opened on ${event.slug}.` : decision.reason,
    };
  }

  async run(onTick?: (result: TradingTickResult) => void): Promise<never> {
    for (;;) {
      try {
        const result = await this.tick();
        onTick?.(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onTick?.({ message: `Trading tick failed safely: ${message}` });
      }
      await new Promise(resolve => setTimeout(resolve, this.config.pollMs));
    }
  }
}
