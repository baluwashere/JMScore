# T4R-2 — true L2 acquisition audit

## Objective

Determine the lowest-cost reliable path to obtain reconstructible historical Binance USD-M BTCUSDT perpetual L2 data for JMScore before any further alpha/model search.

## Priority order

1. Binance authenticated `GET /sapi/v1/futures/histDataLink`.
2. CoinAPI Flat Files `LIMITBOOK_FULL` for `BINANCEFTS_PERP_BTC_USDT`.
3. Tardis.dev Binance perpetual tick-level L2.
4. Amberdata historical Binance futures order-book events.

No vendor purchase is justified until the Binance native path is tested.

## Binance native gate

Probe a single untouched research date: `2023-09-15`.

Request both:
- `T_DEPTH`: tick-level L2 order-book data.
- `S_DEPTH`: L2 snapshot data.

The request is USER_DATA signed. Credentials must only come from environment variables / secret storage; they must never be printed or committed.

Pass criteria:
- endpoint returns one or more entries for BTCUSDT on the requested date;
- signed download URL is reachable before expiry;
- downloaded archive schema contains actual price levels and quantities;
- timestamps/update identifiers permit chronological replay;
- for T_DEPTH, gaps and reset semantics can be detected rather than silently bridged;
- for S_DEPTH, snapshot depth/cadence is measured explicitly.

A Binance result may be classified:
- `BINANCE_NATIVE_L2_USABLE`
- `BINANCE_NATIVE_L2_PARTIAL`
- `BINANCE_NATIVE_L2_UNAVAILABLE`

## External-vendor gate

If Binance native L2 is unavailable or incomplete enough to invalidate event reconstruction, compare vendors on:
- BTCUSDT perpetual coverage during 2023;
- incremental market-by-price L2 updates, not coarse depth bands;
- exchange timestamp and collector/local timestamp;
- snapshots/reset support for deterministic reconstruction;
- documented gap/completeness handling;
- downloadable/replay-friendly format;
- one-symbol one-year acquisition cost;
- licensing suitable for private research and derived features.

## Required output

The audit must end with one acquisition decision, not a model result. No alpha model, target, threshold or Jev prompt may be changed in T4R-2.

## Sources

- Binance historical order-book API: https://binance.github.io/binance-api-swagger/
- Historical Binance futures order-book download description: https://github.com/binance/binance-public-data
- Tardis: https://tardis.dev/
- CoinAPI Flat Files: https://www.coinapi.io/products/flat-files/
- Amberdata Binance market data: https://www.amberdata.io/binance-market-data
