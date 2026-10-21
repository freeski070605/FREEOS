import { ObservationLog } from "./observation-log";
import { PaperLedger } from "./paper-ledger";
import type { EventOutcomeRecord, PaperPosition, SettledPaperPosition } from "./types";

export interface PaperReconcileSummary {
  pendingBefore: number;
  repaired: number;
  pendingAfter: number;
  pendingWithKnownOutcomeAfter: number;
  pendingWithoutKnownOutcomeAfter: number;
  settled: SettledPaperPosition[];
}

function sideSettlement(position: PaperPosition, outcome: EventOutcomeRecord): number {
  return position.side === "UP" ? outcome.upSettlement : outcome.downSettlement;
}

/**
 * Reconcile paper positions strictly from outcomes already recorded in the observation log.
 * This is local-only: it does not call Polymarket and is safe to run repeatedly because
 * PaperLedger.openPositions() excludes position ids that already have PAPER_SETTLE records.
 */
export function reconcilePaperLedgerFromRecordedOutcomes(dataDir: string): PaperReconcileSummary {
  const ledger = new PaperLedger(dataDir);
  const observations = new ObservationLog(dataDir);
  const outcomeByEvent = new Map(observations.outcomes().map(outcome => [outcome.eventSlug, outcome]));
  const pendingBeforePositions = ledger.openPositions();
  const settled: SettledPaperPosition[] = [];

  for (const position of pendingBeforePositions) {
    const outcome = outcomeByEvent.get(position.eventSlug);
    if (!outcome) continue;
    settled.push(ledger.settle(position, sideSettlement(position, outcome)));
  }

  const pendingAfterPositions = ledger.openPositions();
  const pendingWithKnownOutcomeAfter = pendingAfterPositions.filter(position => outcomeByEvent.has(position.eventSlug)).length;

  return {
    pendingBefore: pendingBeforePositions.length,
    repaired: settled.length,
    pendingAfter: pendingAfterPositions.length,
    pendingWithKnownOutcomeAfter,
    pendingWithoutKnownOutcomeAfter: pendingAfterPositions.length - pendingWithKnownOutcomeAfter,
    settled,
  };
}
