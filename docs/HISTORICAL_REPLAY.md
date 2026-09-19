# Historical replay strategy

JMScore must be able to evaluate the same market-state and feature code against both live and historical data. Historical testing is therefore part of the architecture, not a later reporting add-on.

## First-principles rule

Never fabricate unavailable microstructure.

A historical run declares an explicit capability mask. Features that require unavailable inputs must return unavailable rather than substituting approximations that would make backtest and live behavior incomparable.

## Public Binance USD-M data we can use

| Dataset | Historical use | Fidelity for JMScore |
| --- | --- | --- |
| `aggTrades` | price path, trade volume, aggressor imbalance, realized volatility | high |
| `bookTicker` | exact L1 best bid/ask, spread, L1 quantities, L1 microprice | high, after ordering/continuity QA |
| `markPriceKlines` | slower mark-price context | useful but not identical to the live 1-second mark-price stream |
| funding history | funding context | useful/optional |
| `bookDepth` archive | coarse depth bands | not equivalent to live top-20 depth; do not use as L5/L20 |
| open-interest/metrics archives | optional regime context | add only after continuity QA |

The broad historical backtest should therefore start with trades + L1/BBO. Exact L5/L20 order-book features remain a forward-data feature unless a separate high-fidelity historical L2 source is added.

## Data-quality policy

Historical files are inputs, not ground truth. Before a period is admitted into a benchmark:

1. verify the archive checksum when published;
2. verify timestamps are monotonic after normalization;
3. identify gaps and duplicates;
4. sort `bookTicker` by event time and update ID when necessary;
5. record the capability/coverage level of every run;
6. never forward-fill high-frequency market microstructure across a gap;
7. keep the final chronological holdout untouched until the strategy definition is frozen.

## Current replay path

The collector package now contains:

- `ReplayMarketClock`: deterministic simulated time;
- `RollingMarketState`: the same state implementation used by live collection;
- `readBinanceVisionAggTrades`: parser for decompressed futures aggTrades CSV;
- `readBinanceVisionBookTicker`: parser for decompressed futures bookTicker CSV;
- `mergeSortedEventStreams`: chronological k-way merge;
- `replayMarketEvents`: deterministic event replay;
- an explicit historical capability mask.

Example after downloading and decompressing official Binance Vision files:

```bash
npm --workspace @jmscore/collector run replay -- \
  --symbol BTCUSDT \
  --agg-trades ./data/BTCUSDT-aggTrades-2025-01.csv \
  --book-ticker ./data/BTCUSDT-bookTicker-2025-01-15.csv \
  --snapshot-ms 1000
```

The command validates ordering and state invariants and exits on a non-monotonic stream rather than silently producing a misleading result.

## Evaluation order

1. T3: prove deterministic historical replay and live-state parity.
2. T4: build feature engine with an availability mask.
3. T4B: run broad historical backtest before Jev or further live infrastructure.
4. Continue collecting exact live L20 data so microstructure-only features accumulate their own forward validation set.

This gives two complementary evidence tracks: long historical coverage for price/volume/L1 features and shorter but exact forward coverage for L5/L20 microstructure.
