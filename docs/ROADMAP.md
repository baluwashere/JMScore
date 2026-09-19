# JMScore implementation roadmap

The order is intentionally strict. Do not skip from research infrastructure to live execution.

## T1 — Database and experiment foundation

Status: scaffolded; Turso database exists, but schema application and connection smoke test are still pending.

- [x] TypeScript strict workspace
- [x] Turso/libSQL client
- [x] Drizzle configuration
- [x] research schema
- [x] experiment version fields
- [x] create Turso database
- [x] generate initial migration
- [ ] apply migration
- [ ] insert/read smoke test

Acceptance: a test experiment and feature snapshot can be inserted and read from Turso.

## T2 — BTC market collector

Status: complete and live-smoke validated in GitHub Actions.

- [x] define exchange adapter interface
- [x] choose first public BTC perpetual feed
- [x] websocket reconnect/backoff
- [x] trade stream
- [x] order-book stream
- [x] mark/funding/open-interest sources where available
- [x] data freshness monitoring
- [x] live smoke test for all four core WebSocket feeds

Implementation note: Binance open interest remains an optional/degraded feed because the REST endpoint can return HTTP 451 from restricted hosting regions. This does not invalidate the core market-state collector; OI remains nullable and explicitly reported as stale when unavailable.

Acceptance: collector survives disconnects, exposes per-feed freshness, and receives live BTC aggregate trades, order-book depth, best bid/ask and mark/funding data.

## T3 — Rolling market state + historical replay

Status: complete; typecheck, state/replay tests and live collector smoke validated in GitHub Actions.

- [x] bounded trade buffers
- [x] local top-20 order-book state
- [x] stale-data detection
- [x] deterministic system/replay clock
- [x] reject crossed/invalid/out-of-order state updates
- [x] Binance Vision aggTrades parser
- [x] Binance Vision bookTicker parser
- [x] chronological multi-feed merge
- [x] replay capability mask so unavailable historical features are never fabricated
- [x] replay CLI for decompressed Binance Vision CSV files
- [x] validate latest T3 implementation with live collector smoke test

Historical-data rule: exact historical L1/BBO and trade replay is supported. Binance Vision `bookDepth` is not treated as equivalent to live top-20 depth because the historical product is aggregated/sampled differently. L5/L20 features therefore require forward-collected data or a separate high-fidelity L2 source.

Acceptance: live and historical events feed the same rolling state implementation; stale, malformed and unsupported data cannot silently enter the feature engine.

## T4 — Feature engine

Status: complete as `features-v001`; deterministic unit tests and anti-look-ahead test pass in CI.

- [x] returns 15s/30s/1m/3m/5m/15m
- [x] 1m aggressor-volume imbalance and 1m volume z-score vs 20 prior buckets
- [x] L1/L5/L20 book imbalance
- [x] spread and microprice delta
- [x] realized volatility 1m/5m/15m
- [x] optional OI/funding fields
- [x] explicit feature availability mask and unavailable reasons
- [x] fixed deterministic fixtures and fail-closed tests
- [x] explicit test that future trades cannot change current features

Feature-version rule: any semantic or formula change must create a new version (`features-v002`, etc.) rather than silently altering historical experiments.

Acceptance: features are deterministic from fixed fixtures and unavailable historical inputs produce `unavailable`, never invented values.

## T4B — Historical backtest gate

This gate now happens before building more live persistence or adding Jev.

- [ ] acquire official BTCUSDT USD-M aggTrades history (broad period, starting with 2023–2025)
- [ ] acquire daily BTCUSDT bookTicker history for exact L1/BBO
- [ ] checksum and continuity QA
- [ ] normalize/sort historical archives before replay
- [ ] generate feature snapshots without look-ahead
- [ ] deterministic momentum baseline v0
- [ ] label 30s/1m/5m/15m future returns and 5m MFE/MAE
- [ ] chronological train/validation/test split
- [ ] report performance by year/regime and data-coverage level

Acceptance: before Jev is introduced, we can quantify whether the underlying momentum hypothesis has any historical signal and exactly which feature subsets are testable from public historical data.

## T5 — Snapshot sampler

- [ ] deterministic long/short candidate rule v1
- [ ] candidate snapshots
- [ ] control sampling
- [ ] feature versioning
- [ ] daily write guardrail

Acceptance: Turso contains candidate and non-candidate control states without raw tick persistence.

## T6 — Outcome worker

- [ ] label 30s/1m/5m/15m prices and returns
- [ ] MFE/MAE over 5m
- [ ] idempotent labeling
- [ ] missing-data handling

Acceptance: each eligible snapshot receives one immutable raw outcome record.

## T7 — Forward naive momentum baseline

- [ ] baseline signal generator
- [ ] long/short/no-trade states
- [ ] baseline metrics
- [ ] compare forward results with T4B historical results

Acceptance: live/forward baseline behavior is consistent enough with historical evaluation to justify adding Jev.

## T8 — Vercel AI Gateway + Jev

- [ ] current Gateway model/capability verification
- [ ] typed Jev state schema
- [ ] market-state evaluation abstraction
- [ ] output validation
- [ ] latency/cost instrumentation
- [ ] fail-closed behavior
- [ ] daily call guardrail

Acceptance: a fixed feature snapshot can be evaluated repeatedly and its complete model/prompt metadata recorded.

## T9 — Jev recorder

- [ ] candidate → Jev pipeline
- [ ] persistence
- [ ] retry policy for transient infrastructure failures
- [ ] no-trade behavior on invalid/late responses

Acceptance: end-to-end market state → Jev prediction → future outcome dataset is produced automatically.

## T10 — Research dashboard

- [ ] sample volume/data freshness
- [ ] confidence calibration buckets
- [ ] outcomes by confidence
- [ ] Jev vs naive momentum
- [ ] regime segmentation

Acceptance: dashboard directly answers whether Jev confidence contains incremental predictive information.

## T11 — Quantitative baselines

- [ ] logistic regression
- [ ] gradient boosting when sample size justifies it
- [ ] chronological train/validation/test

## T12 — Cost-aware paper execution

- [ ] fee/spread/slippage/latency models
- [ ] optimistic/realistic/pessimistic scenarios
- [ ] fixed notional sizing
- [ ] deterministic risk engine

## T13 — Walk-forward evaluation

- [ ] immutable experiment definitions
- [ ] walk-forward windows
- [ ] final untouched holdout
- [ ] concentration/stability analysis

## T14 — Shadow live

Generate intended real orders without submitting them and compare modeled vs actually executable fills.

No real-money automation before T14 passes.
