# FREEOS BTC 15m Trading Core

Paper-mode research and execution framework for Polymarket US **BTC Up or Down 15m** markets.

## Status

`v0.1` is intentionally **paper only**. `FREEOS_TRADING_MODE` must be `paper`; any other value throws before the engine starts. There is no authenticated order-placement path in this version.

## What it does

- Finds the current Polymarket US BTC 15-minute event automatically.
- Reads the public Up/Down best bid and best ask.
- Builds an independent BTC/USD proxy from Kraken public trades.
- Aligns the opening proxy to the one-minute window immediately preceding the market start.
- Estimates Up/Down probability from price distance to the opening proxy, recent one-second volatility, and seconds remaining.
- Compares model probability with the executable Polymarket ask after configurable friction and slippage buffers.
- Paper-trades only when the adjusted edge clears the configured threshold.
- Persists opens and settlements to a JSONL ledger.
- Logs every successful 5-second market/model observation, not only trades.
- Resolves every observed event after settlement is published so model calibration can be measured even when FREEOS passed.
- Enforces one position per event, spread/time gates, a daily loss stop, and a consecutive-loss stop.

## Resolution truth vs. signal proxy

Polymarket US resolves the BTC 15-minute market using **CF Benchmarks BRTI**, with opening and closing values based on one-second observations from the minute immediately preceding each boundary. FREEOS v0.1 does **not** claim Kraken BTC/USD is BRTI. Kraken is only a low-cost public proxy used to build and calibrate the first signal model.

That distinction matters: paper results must be collected and calibrated against actual Polymarket settlements before any live executor is considered.

## Run on FREEOS

From the repository root in PowerShell:

```powershell
cd E:\FREEOS
git fetch origin
git switch feature/btc15m-trading-core
git pull --ff-only
npm install
npm run build --workspace @freeos/trading-core

$env:FREEOS_TRADING_MODE="paper"
npm run paper --workspace @freeos/trading-core
```

Run one observation/decision cycle instead of the continuous loop:

```powershell
$env:FREEOS_TRADING_MODE="paper"
npm run paper --workspace @freeos/trading-core -- --once
```

The paper ledger and observation stream are written under:

```text
E:\FREEOS\data\trading\btc15m-paper-ledger.jsonl
E:\FREEOS\data\trading\btc15m-observations.jsonl
```

Set `FREEOS_DATA_DIR` to override the FREEOS data root.

## Analyze collected data

After observations and settlements have accumulated:

```powershell
npm run analyze --workspace @freeos/trading-core
```

The report includes:

- number of observations and observed/resolved events;
- Brier score and log loss for model calibration;
- directional accuracy;
- Polymarket midpoint Brier score when a two-sided quote was available;
- average absolute disagreement between FREEOS probability and the market midpoint;
- calibration split into `14-15m`, `12-14m`, `10-12m`, `8-10m`, `6-8m`, `4-6m`, `2-4m`, and `0-2m` time-remaining buckets;
- paper trades opened/settled, wins/losses, total P&L, ROI, and win rate.

Do not interpret tiny samples as evidence of an edge. The point of the observation stream is to accumulate enough resolved windows to compare model behavior by time remaining and disagreement size before changing strategy rules.

## Paper-mode controls

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `FREEOS_TRADING_POLL_MS` | `5000` | Observation loop interval |
| `FREEOS_TRADING_MIN_EDGE` | `0.05` | Minimum adjusted probability edge |
| `FREEOS_TRADING_PAPER_NOTIONAL_USD` | `5` | Paper notional per qualifying event |
| `FREEOS_TRADING_MAX_SPREAD` | `0.06` | Maximum allowed bid/ask spread |
| `FREEOS_TRADING_MIN_SECONDS_TO_EXPIRY` | `75` | No new positions inside this window |
| `FREEOS_TRADING_MAX_DAILY_PAPER_LOSS_USD` | `20` | Daily paper P&L circuit breaker |
| `FREEOS_TRADING_MAX_CONSECUTIVE_LOSSES` | `4` | Loss-streak circuit breaker |
| `FREEOS_TRADING_FRICTION_BPS` | `75` | Conservative model friction buffer |
| `FREEOS_TRADING_SLIPPAGE` | `0.005` | Per-share model slippage buffer |

These are research defaults, not recommended live position sizes or claims about Polymarket's fee formula.

## Before live trading

Live execution should remain locked until all of the following are complete:

1. Build and test a historical replay/backtest from resolved 15-minute markets.
2. Measure calibration (Brier score/log loss), hit rate, expected value, realized edge, drawdown, and performance by time-to-expiry bucket.
3. Replace or calibrate the Kraken proxy against a resolution-grade BRTI-compatible source.
4. Integrate the official `polymarket-us` SDK for authenticated account/order operations.
5. Add order preview, balance/position reconciliation, idempotency, stale-quote protection, and cancel/replace handling.
6. Put live execution behind a separate explicit FREEOS approval gate and hard bankroll/exposure limits.
7. Keep credentials local and out of the repository, logs, prompts, and chat.
