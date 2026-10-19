import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Btc15mEvent, PaperPosition, SettledPaperPosition, StrategyDecision, TradingRiskConfig } from "./types";
import type { RiskState } from "./strategy";

interface OpenRecord { type: "PAPER_OPEN"; position: PaperPosition }
interface SettleRecord { type: "PAPER_SETTLE"; position: SettledPaperPosition }
type LedgerRecord = OpenRecord | SettleRecord;

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class PaperLedger {
  readonly directory: string;
  readonly ledgerPath: string;

  constructor(dataDir: string) {
    this.directory = resolve(dataDir);
    mkdirSync(this.directory, { recursive: true });
    this.ledgerPath = join(this.directory, "btc15m-paper-ledger.jsonl");
  }

  private records(): LedgerRecord[] {
    if (!existsSync(this.ledgerPath)) return [];
    return readFileSync(this.ledgerPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        try { return [JSON.parse(line) as LedgerRecord]; }
        catch { return []; }
      });
  }

  private append(record: LedgerRecord): void {
    appendFileSync(this.ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  openPosition(eventSlug?: string): PaperPosition | null {
    const open = new Map<string, PaperPosition>();
    for (const record of this.records()) {
      if (record.type === "PAPER_OPEN") open.set(record.position.id, record.position);
      else open.delete(record.position.id);
    }
    const positions = [...open.values()].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
    return positions.find(position => !eventSlug || position.eventSlug === eventSlug) ?? null;
  }

  hasTradedEvent(eventSlug: string): boolean {
    return this.records().some(record => record.position.eventSlug === eventSlug);
  }

  open(decision: StrategyDecision, event: Btc15mEvent, config: TradingRiskConfig): PaperPosition {
    if (decision.action !== "BUY" || !decision.side || !decision.marketSlug ||
        decision.modelProbability === undefined || decision.executablePrice === undefined ||
        decision.rawEdge === undefined || decision.adjustedEdge === undefined || decision.notionalUsd === undefined) {
      throw new Error("Cannot open a paper position from a PASS or incomplete decision.");
    }
    if (this.hasTradedEvent(event.slug)) throw new Error(`Paper ledger already contains a trade for ${event.slug}.`);

    const openedAt = new Date().toISOString();
    const notionalUsd = decision.notionalUsd;
    const position: PaperPosition = {
      id: `${event.slug}:${decision.side}:${Date.now()}`,
      eventSlug: event.slug,
      marketSlug: decision.marketSlug,
      side: decision.side,
      openedAt,
      modelProbability: decision.modelProbability,
      fillPrice: decision.executablePrice,
      shares: notionalUsd / decision.executablePrice,
      notionalUsd,
      frictionUsd: notionalUsd * (config.frictionBps / 10_000),
      rawEdge: decision.rawEdge,
      adjustedEdge: decision.adjustedEdge,
    };
    this.append({ type: "PAPER_OPEN", position });
    return position;
  }

  settle(position: PaperPosition, settlement: number): SettledPaperPosition {
    if (!Number.isFinite(settlement) || settlement < 0 || settlement > 1) {
      throw new Error(`Settlement must be between 0 and 1, received ${settlement}.`);
    }
    const grossPayoutUsd = position.shares * settlement;
    const settled: SettledPaperPosition = {
      ...position,
      settledAt: new Date().toISOString(),
      settlement,
      grossPayoutUsd,
      pnlUsd: grossPayoutUsd - position.notionalUsd,
    };
    this.append({ type: "PAPER_SETTLE", position: settled });
    return settled;
  }

  riskState(eventSlug: string, now = new Date()): RiskState {
    const records = this.records();
    const settlements = records
      .filter((record): record is SettleRecord => record.type === "PAPER_SETTLE")
      .map(record => record.position)
      .sort((a, b) => Date.parse(a.settledAt) - Date.parse(b.settledAt));
    const today = localDayKey(now.toISOString());
    const realizedPnlTodayUsd = settlements
      .filter(position => localDayKey(position.settledAt) === today)
      .reduce((sum, position) => sum + position.pnlUsd, 0);

    let consecutiveLosses = 0;
    for (let i = settlements.length - 1; i >= 0; i--) {
      if (settlements[i].pnlUsd >= 0) break;
      consecutiveLosses++;
    }

    return {
      realizedPnlTodayUsd,
      consecutiveLosses,
      alreadyTradedEvent: records.some(record => record.position.eventSlug === eventSlug),
    };
  }
}
