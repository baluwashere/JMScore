# Conditional momentum v1 — 2023 discovery protocol

This protocol is committed before running the v1 search results.

## Objective

Determine whether the failed momentum-v0 signal contains an economically meaningful conditional subset before introducing Jev.

## Data isolation

- Instrument: Binance USD-M BTCUSDT perpetual.
- Source: official Binance Vision 1-minute klines.
- 2023 only for this stage.
- Discovery: 2023-01-01 through 2023-06-30 UTC.
- Internal confirmation: 2023-07-01 through 2023-12-31 UTC.
- 2024 and 2025 MUST NOT be loaded by this experiment.

## Execution semantics

The signal is formed after minute `t` closes. Entry is the open of `t+1`. Primary exit is the open five minutes after entry. Only one five-minute position may be open at a time for the primary selection metric.

## Base directional signal

LONG when:
- return_1m > 0
- return_5m > 0
- taker-volume imbalance > 0

SHORT when all three are negative.

## Conditional mechanisms

Only four conditional families are allowed in this discovery run:

1. `momentum_strength`: `abs(return_5m) / realized_vol_15m`; discovery-period thresholds are q50, q75, q90.
2. `imbalance_strength`: absolute one-minute taker-volume imbalance; discovery-period thresholds are q50, q75, q90.
3. `volume_z20`: current one-minute volume z-score versus the previous 20 completed one-minute buckets; fixed thresholds 0, 1, 2.
4. `persistence_5`: number of the last five one-minute close-to-close returns agreeing with the signal direction; fixed thresholds 3, 4, 5.

Allowed candidate rules use either one or two of these families. No three-way/four-way conjunctions, no indicator additions, and no threshold changes after results are seen.

Each rule is evaluated in three direction scopes: BOTH, LONG_ONLY, SHORT_ONLY.

## Selection

Primary metric: mean gross five-minute return in basis points on non-overlapping positions.

Discovery eligibility:
- at least 500 non-overlapping H1 trades;
- ranked by H1 mean gross five-minute return;
- retain at most the top 10 rules.

A rule only survives internal confirmation if H2 independently has:
- at least 300 non-overlapping trades;
- mean gross five-minute return > 10 bps;
- mean net return after a 10 bps round-trip cost > 0;
- net-10bps profit factor > 1;
- same return sign as H1.

A fixed-seed daily block bootstrap 95% CI is reported for H2 mean gross return. This CI is descriptive; economic thresholds remain the primary gate.

## Interpretation

If no rule passes H2, conditional momentum v1 is a NO-GO at one-minute resolution and Jev is not added to this branch of the strategy. If at least one simple rule passes, the simplest passing rule is frozen before opening 2024 validation data.
