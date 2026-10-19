import { buildAnalyticsSummary } from "./analytics";
import { defaultTradingConfig } from "./engine";

function main(): void {
  const config = defaultTradingConfig();
  const summary = buildAnalyticsSummary(config.dataDir);
  console.log(JSON.stringify(summary, null, 2));
}

main();
