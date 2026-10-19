export type TradeSide = "UP" | "DOWN";

export interface OutcomeMarket {
  id: number;
  slug: string;
  title: string;
  outcome: string;
  active: boolean;
  closed: boolean;
  liquidity?: number;
  volume?: number;
}

export interface Btc15mEvent {
  id: number;
  slug: string;
  title: string;
  startTime: string;
  endTime: string;
  upMarket: OutcomeMarket;
  downMarket: OutcomeMarket;
}

export interface MarketQuote {
  marketSlug: string;
  bestBid: number | null;
  bestAsk: number | null;
  lastTrade: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  observedAt: string;
}

export interface PricePoint {
  ts: number;
  price: number;
}

export interface ProbabilitySnapshot {
  pUp: number;
  pDown: number;
  proxyOpenTwap: number;
  proxyCurrent: number;
  logDistance: number;
  sigmaPerSqrtSecond: number;
  remainingSeconds: number;
  sampleCount: number;
}

export interface TradingSnapshot {
  event: Btc15mEvent;
  up: MarketQuote;
  down: MarketQuote;
  probability: ProbabilitySnapshot;
  observedAt: string;
}

export interface StrategyDecision {
  action: "BUY" | "PASS";
  side?: TradeSide;
  marketSlug?: string;
  modelProbability?: number;
  executablePrice?: number;
  rawEdge?: number;
  adjustedEdge?: number;
  notionalUsd?: number;
  reason: string;
}

export interface PaperPosition {
  id: string;
  eventSlug: string;
  marketSlug: string;
  side: TradeSide;
  openedAt: string;
  modelProbability: number;
  fillPrice: number;
  shares: number;
  notionalUsd: number;
  frictionUsd: number;
  rawEdge: number;
  adjustedEdge: number;
}

export interface SettledPaperPosition extends PaperPosition {
  settledAt: string;
  settlement: number;
  grossPayoutUsd: number;
  pnlUsd: number;
}

export interface TradingRiskConfig {
  minAdjustedEdge: number;
  maxNotionalUsd: number;
  maxSpread: number;
  minSecondsToExpiry: number;
  maxDailyLossUsd: number;
  maxConsecutiveLosses: number;
  frictionBps: number;
  slippage: number;
}

export interface TradingEngineConfig {
  pollMs: number;
  dataDir: string;
  risk: TradingRiskConfig;
}
