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

## T3 — Rolling market state

- [ ] bounded trade buffers
- [ ] rolling price windows
- [ ] local order-book state
- [ ] stale-data detection
- [ ] deterministic clock handling

Acceptance: feature engine never consumes stale or internally inconsistent state silently.

## T4 — Feature engine

- [ ] returns 15s/30s/1m/3m/5m/15m
- [ ] volume imbalance/z-score
- [ ] L1/L5/L20 book imbalance
- [ ] spread and microprice delta
- [ ] realized volatility 1m/5m/15m
- [ ] optional OI/funding fields
- [ ] unit tests for each feature

Acceptance: features are deterministic from fixed fixtures.

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

## T7 — Naive momentum baseline

- [ ] baseline signal generator
- [ ] long/short/no-trade states
- [ ] baseline metrics

Acceptance: baseline can be evaluated before Jev is introduced.

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
