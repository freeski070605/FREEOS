import { Btc15mPaperEngine, defaultTradingConfig } from "./engine";
import { reconcilePaperLedgerFromRecordedOutcomes } from "./reconcile";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function buildEngine(): Btc15mPaperEngine {
  const mode = (process.env.FREEOS_TRADING_MODE ?? "paper").trim().toLowerCase();
  if (mode !== "paper") {
    throw new Error("trading-core v0.1 only permits FREEOS_TRADING_MODE=paper. Live execution is intentionally locked.");
  }

  const config = defaultTradingConfig();
  config.pollMs = envNumber("FREEOS_TRADING_POLL_MS", config.pollMs);
  // V6 paper profile: selected on the older chronological training split only.
  // The 7.5% adjusted-edge + 15% modeled-EV gate remained profitable on the newer
  // holdout while retaining more opportunities than the stricter V5 profile.
  // This is still paper-only research, not evidence of live profitability.
  config.risk.minAdjustedEdge = envNumber("FREEOS_TRADING_MIN_EDGE", 0.075);
  config.risk.minExpectedRoi = envNumber("FREEOS_TRADING_MIN_EXPECTED_ROI", 0.15);
  config.risk.maxNotionalUsd = envNumber("FREEOS_TRADING_PAPER_NOTIONAL_USD", config.risk.maxNotionalUsd);
  config.risk.maxSpread = envNumber("FREEOS_TRADING_MAX_SPREAD", config.risk.maxSpread);
  config.risk.minSecondsToExpiry = envNumber("FREEOS_TRADING_MIN_SECONDS_TO_EXPIRY", config.risk.minSecondsToExpiry);
  config.risk.maxSecondsToExpiry = envNumber("FREEOS_TRADING_MAX_SECONDS_TO_EXPIRY", config.risk.maxSecondsToExpiry);
  config.risk.minExecutablePrice = envNumber("FREEOS_TRADING_MIN_EXECUTABLE_PRICE", 0.40);
  config.risk.maxDailyLossUsd = envNumber("FREEOS_TRADING_MAX_DAILY_PAPER_LOSS_USD", config.risk.maxDailyLossUsd);
  config.risk.maxConsecutiveLosses = envNumber("FREEOS_TRADING_MAX_CONSECUTIVE_LOSSES", config.risk.maxConsecutiveLosses);
  config.risk.frictionBps = envNumber("FREEOS_TRADING_FRICTION_BPS", config.risk.frictionBps);
  config.risk.slippage = envNumber("FREEOS_TRADING_SLIPPAGE", config.risk.slippage);
  return new Btc15mPaperEngine(config);
}

function printTick(result: Awaited<ReturnType<Btc15mPaperEngine["tick"]>>): void {
  const p = result.snapshot?.probability;
  const payload = {
    at: new Date().toISOString(),
    event: result.snapshot?.event.slug,
    marketStructure: result.snapshot?.marketStructure,
    pUp: p ? Number(p.pUp.toFixed(4)) : undefined,
    proxyOpen: p ? Number(p.proxyOpenTwap.toFixed(2)) : undefined,
    proxyCurrent: p ? Number(p.proxyCurrent.toFixed(2)) : undefined,
    secondsLeft: p ? Number(p.remainingSeconds.toFixed(1)) : undefined,
    upBid: result.snapshot?.up.bestBid,
    upAsk: result.snapshot?.up.bestAsk,
    downBid: result.snapshot?.down.bestBid,
    downAsk: result.snapshot?.down.bestAsk,
    decision: result.decision,
    opened: result.opened,
    settled: result.settled?.length ? result.settled : undefined,
    resolvedOutcomes: result.resolvedOutcomes?.length ? result.resolvedOutcomes : undefined,
    message: result.message,
  };
  console.log(JSON.stringify(payload));
}

async function main(): Promise<void> {
  const engine = buildEngine();

  const repair = reconcilePaperLedgerFromRecordedOutcomes(engine.config.dataDir);

  console.log(JSON.stringify({
    service: "FREEOS BTC15M Trader",
    mode: "paper",
    strategy: "v6-late-window-7.5pct-edge-15pct-ev",
    ledger: engine.ledger.ledgerPath,
    observations: engine.observations.logPath,
    entryWindowSeconds: {
      min: engine.config.risk.minSecondsToExpiry,
      max: engine.config.risk.maxSecondsToExpiry,
    },
    minExecutablePrice: engine.config.risk.minExecutablePrice,
    minAdjustedEdge: engine.config.risk.minAdjustedEdge,
    minExpectedRoi: engine.config.risk.minExpectedRoi,
    startupReconcile: {
      pendingBefore: repair.pendingBefore,
      repaired: repair.repaired,
      pendingAfter: repair.pendingAfter,
      pendingWithKnownOutcomeAfter: repair.pendingWithKnownOutcomeAfter,
      pendingWithoutKnownOutcomeAfter: repair.pendingWithoutKnownOutcomeAfter,
    },
    liveExecution: false,
  }));

  if (process.argv.includes("--once")) {
    printTick(await engine.tick());
    return;
  }
  await engine.run(printTick);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
