# T4D-BTC — rare-move + Jev shadow protocol

This protocol is committed before running the T4D historical experiment.

## Objective

Test whether BTCUSDT microstructure can identify rare five-minute executable moves large enough to cover spread, taker fees and a safety margin, and prepare Jev as a shadow meta-filter on those candidates.

## Data isolation

- Instrument: Binance USD-M BTCUSDT perpetual only.
- Historical sources: official Binance Vision daily `aggTrades` and `bookTicker` archives.
- 2023 only. 2024 and 2025 remain unopened.
- Deterministically sampled days: 1, 8, 15 and 22 of June through December 2023, matching T4C.
- Train: June + July.
- Calibration: August.
- Holdout: September–December.

## Execution semantics

- Build one-second state from raw events.
- Evaluate every 30 seconds.
- Features use only events timestamped <= decision time.
- Entry uses executable BBO at t+1s.
- Exit uses executable BBO at t+301s.
- Long: buy ask, later sell bid.
- Short: sell bid, later buy ask.
- Primary round-trip taker fee assumption: 8 bps total.
- Candidate economic barriers are net executable return > 0, >4 bps, >8 bps and >12 bps after the 8 bps fee deduction.

## Features

Reuse the frozen T4C microstructure feature set without additions after holdout is opened:
- returns 5s/15s/30s/60s/300s
- realized volatility 30s/60s/300s
- volume imbalance 5s/15s/30s/60s
- trade-count imbalance 5s/15s/30s/60s
- flow acceleration 5v30 and 15v60
- 30s volume z-score vs previous 20 buckets
- spread bps
- L1 book imbalance
- microprice delta bps
- quote updates 30s

## Quantitative rare-move models

Two fixed model families are evaluated separately for LONG and SHORT success labels:

1. Logistic regression, standardized features, C=1.
2. Histogram gradient boosting, max depth 3, learning rate 0.05, 150 iterations, L2=1.0, fixed seed.

Each barrier is a separate binary prediction task. No hyperparameter search.

## Candidate selection

For each model/direction/barrier, calibration-only probability thresholds are fixed in advance:

`0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.65, 0.70, 0.75, 0.80`

Choose the threshold on August that maximizes mean realized net executable return subject to >= 25 non-overlapping trades. Freeze it before holdout.

A timestamp may become a candidate only for one side. If both long and short cross threshold, choose the side with larger probability margin over its threshold; exact ties are NO_TRADE.

Only one five-minute position may be open at a time.

## Primary gate

A formulation passes the Sep–Dec pilot only if:
- >= 100 non-overlapping holdout trades;
- mean net executable return > 0 after 8 bps fees;
- net profit factor > 1;
- calibration and holdout mean net return have the same sign;
- daily-block bootstrap 95% CI for holdout mean net return is reported.

Passing this pilot is not sufficient to open 2024. The frozen formulation must first be replicated on every eligible Jun–Dec 2023 day.

## Jev shadow role

Jev is not used to discover candidates and is not allowed to execute or size trades.

For each quantitative candidate, the application sends a compact state containing:
- recent price returns and volatility;
- order-flow imbalances and acceleration;
- spread, L1 book imbalance and microprice delta;
- quantitative side and calibrated probability;
- economic barrier and estimated executable cost.

Jev returns bounded typed judgments:
- regime: CONTINUATION / REVERSAL / EXHAUSTION / CHOP / UNCLEAR;
- continuation boolean probability;
- false-breakout boolean probability;
- setup-quality score 0–4.

All Jev outputs are shadow-only and persisted beside the candidate. The economic comparison later is quantitative candidate performance vs the same candidates filtered by frozen Jev criteria.

## Fail-closed rules

- Missing/stale BBO => no candidate.
- Missing model probability => no candidate.
- Jev error/timeout => retain quantitative candidate for research, but mark Jev unavailable; never synthesize a probability.
- No real-money trading is part of T4D.
