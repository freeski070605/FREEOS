const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { buildAnalyticsSummary } = require("../../packages/trading-core/dist/analytics.js");
const { btc15mProbability } = require("../../packages/trading-core/dist/model.js");
const { ObservationLog } = require("../../packages/trading-core/dist/observation-log.js");
const { PaperLedger } = require("../../packages/trading-core/dist/paper-ledger.js");
const { complementBinaryQuote } = require("../../packages/trading-core/dist/polymarket-us-public.js");
const { reconcilePaperLedgerFromRecordedOutcomes } = require("../../packages/trading-core/dist/reconcile.js");
const { decideTrade } = require("../../packages/trading-core/dist/strategy.js");

function quote(marketSlug, bid, ask) {
  return {
    marketSlug,
    bestBid: bid,
    bestAsk: ask,
    lastTrade: bid,
    bidDepth: 100,
    askDepth: 100,
    observedAt: new Date(0).toISOString(),
  };
}

function snapshot(overrides = {}) {
  const base = {
    event: {
      id: 1,
      slug: "btc-updown-15m-test",
      title: "BTC Up or Down 15m",
      startTime: new Date(0).toISOString(),
      endTime: new Date(900_000).toISOString(),
      upMarket: { id: 11, slug: "up", title: "Up", outcome: "Up", active: true, closed: false },
      downMarket: { id: 12, slug: "down", title: "Down", outcome: "Down", active: true, closed: false },
    },
    marketStructure: "distinct-outcomes",
    up: quote("up", 0.49, 0.50),
    down: quote("down", 0.49, 0.50),
    probability: {
      pUp: 0.66,
      pDown: 0.34,
      proxyOpenTwap: 100,
      proxyCurrent: 101,
      logDistance: Math.log(1.01),
      sigmaPerSqrtSecond: 0.001,
      remainingSeconds: 300,
      sampleCount: 120,
    },
    observedAt: new Date(0).toISOString(),
  };
  return { ...base, ...overrides };
}

const risk = {
  minAdjustedEdge: 0.05,
  maxNotionalUsd: 5,
  maxSpread: 0.06,
  minSecondsToExpiry: 75,
  maxDailyLossUsd: 20,
  maxConsecutiveLosses: 4,
  frictionBps: 0,
  slippage: 0,
};

test("probability moves above 50% when BTC proxy is above opening proxy", () => {
  const now = 120_000;
  const points = [];
  for (let ts = 0; ts <= now; ts += 1000) {
    points.push({ ts, price: 100 + (ts / now) });
  }
  const result = btc15mProbability(100, points, 900_000, now);
  assert.ok(result.pUp > 0.5);
  assert.equal(result.pDown, 1 - result.pUp);
  assert.ok(result.sampleCount >= 100);
});

test("shared binary short quote is complementary to the long book", () => {
  const down = complementBinaryQuote(quote("btc-shared", 0.03, 0.04));
  assert.equal(down.bestBid, 0.96);
  assert.equal(down.bestAsk, 0.97);
});

test("strategy buys the side with sufficient adjusted edge", () => {
  const decision = decideTrade(snapshot(), risk, {
    realizedPnlTodayUsd: 0,
    consecutiveLosses: 0,
    alreadyTradedEvent: false,
  });
  assert.equal(decision.action, "BUY");
  assert.equal(decision.side, "UP");
  assert.equal(decision.marketSlug, "up");
  assert.ok(decision.adjustedEdge >= 0.15);
});

test("strategy refuses a second trade in the same event", () => {
  const decision = decideTrade(snapshot(), risk, {
    realizedPnlTodayUsd: 0,
    consecutiveLosses: 0,
    alreadyTradedEvent: true,
  });
  assert.equal(decision.action, "PASS");
  assert.match(decision.reason, /one-position-per-event/i);
});

test("strategy stops after the daily loss limit", () => {
  const decision = decideTrade(snapshot(), risk, {
    realizedPnlTodayUsd: -20,
    consecutiveLosses: 1,
    alreadyTradedEvent: false,
  });
  assert.equal(decision.action, "PASS");
  assert.match(decision.reason, /daily paper-loss/i);
});

test("strategy refuses new entries too close to expiry", () => {
  const s = snapshot();
  s.probability = { ...s.probability, remainingSeconds: 30 };
  const decision = decideTrade(s, risk, {
    realizedPnlTodayUsd: 0,
    consecutiveLosses: 0,
    alreadyTradedEvent: false,
  });
  assert.equal(decision.action, "PASS");
  assert.match(decision.reason, /too close/i);
});

test("observation log tracks unresolved events until an outcome is recorded", () => {
  const dir = mkdtempSync(join(tmpdir(), "freeos-trading-observation-"));
  try {
    const log = new ObservationLog(dir);
    const s = snapshot();
    log.appendObservation(s, { action: "PASS", reason: "test" });
    assert.equal(log.observations().length, 1);
    assert.equal(log.unresolvedEvents(906_000).length, 1);

    log.appendOutcome({
      eventSlug: s.event.slug,
      eventEndTime: s.event.endTime,
      marketStructure: s.marketStructure,
      upMarketSlug: s.event.upMarket.slug,
      downMarketSlug: s.event.downMarket.slug,
      resolvedAt: new Date(906_000).toISOString(),
      upSettlement: 1,
      downSettlement: 0,
    });
    assert.equal(log.unresolvedEvents(906_000).length, 0);
    assert.equal(log.outcomes().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("paper ledger exposes every unsettled position instead of only the newest", () => {
  const dir = mkdtempSync(join(tmpdir(), "freeos-trading-ledger-"));
  try {
    const ledger = new PaperLedger(dir);
    const first = snapshot().event;
    const second = {
      ...snapshot().event,
      id: 2,
      slug: "btc-updown-15m-test-2",
      startTime: new Date(900_000).toISOString(),
      endTime: new Date(1_800_000).toISOString(),
      upMarket: { ...snapshot().event.upMarket, id: 21, slug: "up-2" },
      downMarket: { ...snapshot().event.downMarket, id: 22, slug: "down-2" },
    };
    const decision = {
      action: "BUY",
      side: "UP",
      marketSlug: "up",
      modelProbability: 0.66,
      executablePrice: 0.5,
      rawEdge: 0.16,
      adjustedEdge: 0.16,
      notionalUsd: 5,
      reason: "test",
    };
    const firstPosition = ledger.open(decision, first, risk);
    ledger.open({ ...decision, marketSlug: "up-2" }, second, risk);
    assert.equal(ledger.openPositions().length, 2);
    ledger.settle(firstPosition, 1);
    assert.equal(ledger.openPositions().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconciliation settles pending positions from already-recorded outcomes", () => {
  const dir = mkdtempSync(join(tmpdir(), "freeos-trading-reconcile-"));
  try {
    const s = snapshot();
    const log = new ObservationLog(dir);
    log.appendObservation(s, { action: "PASS", reason: "test" });
    log.appendOutcome({
      eventSlug: s.event.slug,
      eventEndTime: s.event.endTime,
      marketStructure: s.marketStructure,
      upMarketSlug: s.event.upMarket.slug,
      downMarketSlug: s.event.downMarket.slug,
      resolvedAt: new Date(906_000).toISOString(),
      upSettlement: 1,
      downSettlement: 0,
    });

    const ledger = new PaperLedger(dir);
    ledger.open({
      action: "BUY",
      side: "UP",
      marketSlug: "up",
      modelProbability: 0.66,
      executablePrice: 0.5,
      rawEdge: 0.16,
      adjustedEdge: 0.16,
      notionalUsd: 5,
      reason: "test",
    }, s.event, risk);

    const result = reconcilePaperLedgerFromRecordedOutcomes(dir);
    assert.equal(result.pendingBefore, 1);
    assert.equal(result.repaired, 1);
    assert.equal(result.pendingAfter, 0);
    assert.equal(new PaperLedger(dir).openPositions().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("analytics measures calibration and settled paper PnL", () => {
  const dir = mkdtempSync(join(tmpdir(), "freeos-trading-analytics-"));
  try {
    const s = snapshot();
    const log = new ObservationLog(dir);
    log.appendObservation(s, { action: "PASS", reason: "test" });
    log.appendOutcome({
      eventSlug: s.event.slug,
      eventEndTime: s.event.endTime,
      marketStructure: s.marketStructure,
      upMarketSlug: s.event.upMarket.slug,
      downMarketSlug: s.event.downMarket.slug,
      resolvedAt: new Date(906_000).toISOString(),
      upSettlement: 1,
      downSettlement: 0,
    });

    const ledger = new PaperLedger(dir);
    const position = ledger.open({
      action: "BUY",
      side: "UP",
      marketSlug: "up",
      modelProbability: 0.66,
      executablePrice: 0.5,
      rawEdge: 0.16,
      adjustedEdge: 0.16,
      notionalUsd: 5,
      reason: "test",
    }, s.event, risk);
    ledger.settle(position, 1);

    const summary = buildAnalyticsSummary(dir);
    assert.equal(summary.observations, 1);
    assert.equal(summary.eventsResolved, 1);
    assert.equal(summary.overall.n, 1);
    assert.equal(summary.overall.brier, 0.1156);
    assert.equal(summary.paper.settled, 1);
    assert.equal(summary.paper.pending, 0);
    assert.equal(summary.paper.pendingWithKnownOutcome, 0);
    assert.equal(summary.paper.wins, 1);
    assert.equal(summary.paper.totalPnlUsd, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
