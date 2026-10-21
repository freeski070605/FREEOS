import { buildBacktestReport } from "./backtest";
import { defaultTradingConfig } from "./engine";

function main(): void {
  const config = defaultTradingConfig();
  const report = buildBacktestReport(config.dataDir);
  console.log(JSON.stringify(report, null, 2));
}

main();
