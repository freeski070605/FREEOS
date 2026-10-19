import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EventOutcomeRecord, ObservationRecord, StrategyDecision, TradingSnapshot } from "./types";

interface ObservationEnvelope { type: "OBSERVATION"; observation: ObservationRecord }
interface OutcomeEnvelope { type: "EVENT_OUTCOME"; outcome: EventOutcomeRecord }
type ObservationLogRecord = ObservationEnvelope | OutcomeEnvelope;

function midpoint(bid: number | null, ask: number | null): number | null {
  if (bid === null || ask === null) return null;
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return (bid + ask) / 2;
}

export class ObservationLog {
  readonly directory: string;
  readonly logPath: string;
  private cache: ObservationLogRecord[] | null = null;

  constructor(dataDir: string) {
    this.directory = resolve(dataDir);
    mkdirSync(this.directory, { recursive: true });
    this.logPath = join(this.directory, "btc15m-observations.jsonl");
  }

  private records(): ObservationLogRecord[] {
    if (this.cache) return this.cache;
    if (!existsSync(this.logPath)) {
      this.cache = [];
      return this.cache;
    }
    this.cache = readFileSync(this.logPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        try { return [JSON.parse(line) as ObservationLogRecord]; }
        catch { return []; }
      });
    return this.cache;
  }

  private append(record: ObservationLogRecord): void {
    // Prime the in-memory cache before writing. If we wrote first and then lazily loaded
    // the cache, the just-written record would be read from disk and pushed a second time
    // in memory even though the JSONL file itself only contained one line.
    const records = this.records();
    appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
    records.push(record);
  }

  appendObservation(snapshot: TradingSnapshot, decision: StrategyDecision): ObservationRecord {
    const p = snapshot.probability;
    const observation: ObservationRecord = {
      eventSlug: snapshot.event.slug,
      eventStartTime: snapshot.event.startTime,
      eventEndTime: snapshot.event.endTime,
      upMarketSlug: snapshot.event.upMarket.slug,
      downMarketSlug: snapshot.event.downMarket.slug,
      marketStructure: snapshot.marketStructure,
      observedAt: snapshot.observedAt,
      secondsLeft: p.remainingSeconds,
      proxyOpenTwap: p.proxyOpenTwap,
      proxyCurrent: p.proxyCurrent,
      logDistance: p.logDistance,
      sigmaPerSqrtSecond: p.sigmaPerSqrtSecond,
      sampleCount: p.sampleCount,
      pUp: p.pUp,
      pDown: p.pDown,
      upBid: snapshot.up.bestBid,
      upAsk: snapshot.up.bestAsk,
      downBid: snapshot.down.bestBid,
      downAsk: snapshot.down.bestAsk,
      upMid: midpoint(snapshot.up.bestBid, snapshot.up.bestAsk),
      decisionAction: decision.action,
      decisionSide: decision.side,
      decisionReason: decision.reason,
      adjustedEdge: decision.adjustedEdge,
    };
    this.append({ type: "OBSERVATION", observation });
    return observation;
  }

  appendOutcome(outcome: EventOutcomeRecord): void {
    if (this.hasOutcome(outcome.eventSlug)) return;
    this.append({ type: "EVENT_OUTCOME", outcome });
  }

  observations(): ObservationRecord[] {
    return this.records()
      .filter((record): record is ObservationEnvelope => record.type === "OBSERVATION")
      .map(record => record.observation);
  }

  outcomes(): EventOutcomeRecord[] {
    return this.records()
      .filter((record): record is OutcomeEnvelope => record.type === "EVENT_OUTCOME")
      .map(record => record.outcome);
  }

  hasOutcome(eventSlug: string): boolean {
    return this.records().some(record => record.type === "EVENT_OUTCOME" && record.outcome.eventSlug === eventSlug);
  }

  unresolvedEvents(nowMs = Date.now(), graceMs = 5_000, limit = 4): ObservationRecord[] {
    const records = this.records();
    const settled = new Set(
      records
        .filter((record): record is OutcomeEnvelope => record.type === "EVENT_OUTCOME")
        .map(record => record.outcome.eventSlug),
    );
    const latestByEvent = new Map<string, ObservationRecord>();
    for (const record of records) {
      if (record.type !== "OBSERVATION") continue;
      latestByEvent.set(record.observation.eventSlug, record.observation);
    }

    return [...latestByEvent.values()]
      .filter(observation => {
        const endMs = Date.parse(observation.eventEndTime);
        return !settled.has(observation.eventSlug) && Number.isFinite(endMs) && nowMs >= endMs + graceMs;
      })
      .sort((a, b) => Date.parse(a.eventEndTime) - Date.parse(b.eventEndTime))
      .slice(0, Math.max(1, limit));
  }
}
