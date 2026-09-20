# T4R-2 — external L2 vendor audit

Current audit date: 2026-09-20.

## Decision hierarchy

### 1. Binance native histDataLink — first choice if accessible

`GET /sapi/v1/futures/histDataLink` is a signed USER_DATA endpoint. It supports:
- `T_DEPTH`: tick-level L2 order-book data;
- `S_DEPTH`: L2 snapshots.

Historical Binance documentation states:
- T_DEPTH is directly fetched L2 and may contain gaps;
- S_DEPTH for BTCUSDT was provided around 1 second with 20 price levels;
- request spans must be < 7 days;
- the account must have Futures enabled and the API key may need to be whitelisted for historical order-book access.

Advantages: native source, no normalization ambiguity, likely lowest acquisition cost.
Risk: access entitlement and completeness are uncertain; public reports describe signed-link failures for some later dates. We must test 2023 directly before relying on it.

### 2. CoinAPI Flat Files — preferred paid one-off backfill candidate

Observed/documented capabilities:
- exchange identifier `BINANCEFTS` for Binance USD-M Futures;
- symbol `BINANCEFTS_PERP_BTC_USDT` is explicitly represented in historical file examples;
- `LIMITBOOK_FULL` provides event-level full order-book updates with exchange timestamps;
- historical daily partitions exist for pre-2026-06-09 data;
- pay-as-you-go L2 pricing currently starts at USD 8/GiB for the first 1 GiB/day/SKU, USD 4/GiB for the next 9 GiB/day/SKU and USD 2/GiB above 10 GiB/day/SKU.

Why it ranks second: JMScore currently needs a narrow one-symbol 2023 backfill, so metered flat-file pricing may be materially cheaper than a broad subscription. Exact 2023 BTCUSDT file size must be estimated before purchase; do not infer cost without the estimator/listing.

### 3. Tardis.dev — preferred recurring / multi-market research platform

Observed/documented capabilities:
- tick-by-tick incremental L2 order-book updates and reconstructed snapshots;
- data sourced from exchange WebSocket feeds rather than periodic REST polling;
- Binance perpetuals supported alongside trades, liquidations, funding and OI;
- replay API and downloadable CSV datasets;
- current perpetual-data pricing shown publicly: Academic USD 350/month, Solo USD 700/month, Professional USD 1,000/month, Business USD 3,000/month; historical access is listed as 4 years with yearly billing for non-Business tiers.

Why it ranks third for this task: technically excellent, but broad subscription economics are harder to justify for a single-symbol one-year validation. It becomes attractive if JMScore expands to SOL/ETH or repeated L2 experiments.

### 4. Amberdata — technically suitable, cost opaque

Observed/documented capabilities:
- Binance futures coverage from 2019-09-08;
- tick-level order-book events and historical full order books;
- futures/perpetual data including OI, liquidations and funding;
- API/S3 delivery.

Why it ranks fourth: technically credible but pricing is sales-led/opaque, reducing speed and cost predictability for a narrow research backfill.

## Acquisition decision

1. Test Binance native BTCUSDT `T_DEPTH` + `S_DEPTH` for one day in 2023 using a signed account-specific request.
2. If native data is unavailable or gaps/reset semantics are unacceptable, estimate CoinAPI `BINANCEFTS_PERP_BTC_USDT LIMITBOOK_FULL` size for exactly 2023 before any purchase.
3. Use Tardis instead if the intended scope expands to multiple perpetual markets or recurring high-frequency research.
4. Do not buy Amberdata before receiving a concrete quote that beats the above alternatives on cost/completeness.

## Sources

- Binance Swagger historical L2 endpoint: https://binance.github.io/binance-api-swagger/
- Binance public-data historical futures order-book documentation/history: https://github.com/binance/binance-public-data
- python-binance histDataLink endpoint docs: https://python-binance.readthedocs.io/en/v1.0.29/binance.html
- Tardis: https://tardis.dev/
- CoinAPI flat-file pricing: https://www.coinapi.io/products/flat-files/pricing
- CoinAPI flat-file estimation: https://www.coinapi.io/products/flat-files/docs/estimation-guide
- CoinAPI L2 samples: https://www.coinapi.io/products/flat-files/data-samples
- Amberdata Binance data: https://www.amberdata.io/binance-market-data
