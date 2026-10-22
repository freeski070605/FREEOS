import { defaultTradingConfig } from "./engine";
import { reconcilePaperLedgerFromRecordedOutcomes } from "./reconcile";

function main(): void {
  const config = defaultTradingConfig();
  const result = reconcilePaperLedgerFromRecordedOutcomes(config.dataDir);
  console.log(JSON.stringify({
    action: "paper-settlement-reconcile",
    dataDir: config.dataDir,
    pendingBefore: result.pendingBefore,
    repaired: result.repaired,
    pendingAfter: result.pendingAfter,
    pendingWithKnownOutcomeAfter: result.pendingWithKnownOutcomeAfter,
    pendingWithoutKnownOutcomeAfter: result.pendingWithoutKnownOutcomeAfter,
  }, null, 2));
}

main();
