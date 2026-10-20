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
  settled?: SettledPaperPosition[];
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

  private sideSettlementFromOutcome(position: PaperPosition, outcome: EventOutcomeRecord): number {
    return position.side === "UP" ? outcome.upSettlement : outcome.downSettlement;
  }

  private async settleOpenPositionsIfReady(nowMs: number, maxPerTick = 12): Promise<SettledPaperPosition[]> {
    const ready = this.ledger.openPositions()
      .filter(position => {
        const closeMs = Date.parse(position.eventEndTime);
        return Number.isFinite(closeMs) && nowMs >= closeMs + 5_000 && Boolean(position.marketStructure);
      })
      .slice(0, Math.max(1, maxPerTick));

    if (!ready.length) return [];
    const outcomeByEvent = new Map(this.observations.outcomes().map(outcome => [outcome.eventSlug, outcome]));
    const settled: SettledPaperPosition[] = [];

    for (const position of ready) {
      try {
        const recordedOutcome = outcomeByEvent.get(position.eventSlug);
        if (recordedOutcome) {
          settled.push(this.ledger.settle(position, this.sideSettlementFromOutcome(position, recordedOutcome)));
          continue;
        }

        const rawSettlement = await this.polymarket.settlement(position.marketSlug);
        const sideSettlement = position.marketStructure === "shared-binary" && position.side === "DOWN"
          ? 1 - rawSettlement
          : rawSettlement;
        settled.push(this.ledger.settle(position, sideSettlement));
      } catch {
        // Settlement publication can lag or an old market lookup can fail. Do not let one
        // unresolved position block newer positions from being settled on this tick.
      }
    }

    return settled;
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
    // Resolve event truth first so old paper positions can use the locally recorded outcome
    // instead of depending on historical settlement endpoints remaining immediately available.
    const resolvedOutcomes = await this.resolveObservedEventsIfReady(nowMs);
    const settled = await this.settleOpenPositionsIfReady(nowMs);

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
