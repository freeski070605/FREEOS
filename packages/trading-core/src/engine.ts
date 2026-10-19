import { join, resolve } from "node:path";
import { KrakenReferenceFeed } from "./kraken-reference";
import { btc15mProbability } from "./model";
import { PaperLedger } from "./paper-ledger";
import { PolymarketUSPublicClient } from "./polymarket-us-public";
import { decideTrade } from "./strategy";
import type { Btc15mEvent, PaperPosition, SettledPaperPosition, StrategyDecision, TradingEngineConfig, TradingSnapshot } from "./types";

export interface TradingTickResult {
  snapshot?: TradingSnapshot;
  decision?: StrategyDecision;
  opened?: PaperPosition;
  settled?: SettledPaperPosition;
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
  private cachedEventSlug: string | null = null;
  private cachedOpeningProxyTwap: number | null = null;

  constructor(
    readonly config = defaultTradingConfig(),
    readonly polymarket = new PolymarketUSPublicClient(),
    readonly reference = new KrakenReferenceFeed(),
  ) {
    this.ledger = new PaperLedger(config.dataDir);
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

  private async settleOpenIfReady(nowMs: number): Promise<SettledPaperPosition | undefined> {
    const open = this.ledger.openPosition();
    if (!open) return undefined;
    const closeMs = Date.parse(open.eventEndTime);
    if (!Number.isFinite(closeMs) || nowMs < closeMs + 5_000) return undefined;

    // The public settlement endpoint may not be ready immediately after close. A failed read
    // is non-fatal and will be retried on the next tick.
    try {
      const settlement = await this.polymarket.settlement(open.marketSlug);
      return this.ledger.settle(open, settlement);
    } catch {
      return undefined;
    }
  }

  async tick(nowMs = Date.now()): Promise<TradingTickResult> {
    const settled = await this.settleOpenIfReady(nowMs);
    const event = await this.polymarket.discoverCurrentBtc15m(nowMs);
    const eventEndMs = Date.parse(event.endTime);
    if (!Number.isFinite(eventEndMs)) throw new Error(`Invalid event end time for ${event.slug}.`);

    const [proxyOpenTwap, recentPoints, up, down] = await Promise.all([
      this.openingProxy(event),
      this.reference.recent(180, nowMs),
      this.polymarket.bbo(event.upMarket.slug),
      this.polymarket.bbo(event.downMarket.slug),
    ]);

    const probability = btc15mProbability(proxyOpenTwap, recentPoints, eventEndMs, nowMs);
    const snapshot: TradingSnapshot = {
      event,
      up,
      down,
      probability,
      observedAt: new Date(nowMs).toISOString(),
    };

    if (probability.sampleCount < 30) {
      return {
        snapshot,
        settled,
        decision: { action: "PASS", reason: `Only ${probability.sampleCount} one-second returns available; need at least 30.` },
        message: "Insufficient BTC proxy history for a probability estimate.",
      };
    }

    const state = this.ledger.riskState(event.slug, new Date(nowMs));
    const decision = decideTrade(snapshot, this.config.risk, state);
    const opened = decision.action === "BUY" ? this.ledger.open(decision, event, this.config.risk) : undefined;

    return {
      snapshot,
      decision,
      opened,
      settled,
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
