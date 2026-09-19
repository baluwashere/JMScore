# T4C — Microstructure + ML 2023 pilot protocol

This protocol is committed before the experiment is run.

## Objective

Test whether high-frequency order-flow and top-of-book state contain enough information to identify five-minute BTCUSDT perpetual moves that remain profitable after executable spread and taker fees, before introducing Jev.

## Data isolation

- Instrument: Binance USD-M BTCUSDT perpetual.
- Historical sources: official Binance Vision daily `aggTrades` and `bookTicker` archives.
- 2023 only. Do not load 2024 or 2025.
- `bookTicker` availability constrains this pilot to June–December 2023.
- Deterministically sampled days: day 1, 8, 15 and 22 of each included month.
- Train: June + July 2023 (8 sampled days).
- Calibration: August 2023 (4 sampled days).
- Holdout: September–December 2023 (16 sampled days).

This is a pilot gate. A positive result must later be replicated on all eligible 2023 days before 2024 is opened.

## Data QA

- Verify Binance SHA256 CHECKSUM for every downloaded archive.
- Normalize timestamps to milliseconds.
- Aggregate raw events to one-second state without trusting CSV row order.
- For bookTicker, choose the latest `(event_time, update_id)` within each second.
- Reject crossed/invalid BBO states.
- At decision, entry and exit, BBO age must be <= 2 seconds and trade-price age <= 5 seconds.
- Report raw row counts, crossed quotes, missing archives and usable snapshot coverage.

## Snapshot and execution semantics

- Build one-second state from raw events.
- Evaluate a decision every 30 seconds.
- Features at time `t` use events with timestamps <= `t` only.
- Entry uses the executable BBO at `t+1s`: long buys ask; short sells bid.
- Five-minute exit uses the executable BBO at `t+301s`: long sells bid; short buys ask.
- Spread is therefore embedded in gross executable return.
- Subtract 8 bps round-trip taker fees (4 bps each side) for the primary net result.
- Only one five-minute position may be open at a time in strategy evaluation.

## Feature families

Price:
- return_5s
- return_15s
- return_30s
- return_60s
- return_300s
- realized_vol_30s
- realized_vol_60s
- realized_vol_300s

Order flow:
- volume_imbalance_5s / 15s / 30s / 60s
- count_imbalance_5s / 15s / 30s / 60s
- flow_accel_5v30 = volume_imbalance_5s - volume_imbalance_30s
- flow_accel_15v60 = volume_imbalance_15s - volume_imbalance_60s
- volume_z_30s_vs_20 = current 30-second volume vs previous 20 non-overlapping 30-second buckets

Top of book:
- spread_bps
- book_imbalance_l1
- microprice_delta_bps
- quote_updates_30s

No additional indicators or feature engineering are allowed after holdout results are seen in this pilot.

## Models

Two fixed quantitative baselines:

1. Logistic regression with standardized features, `C=1`, no hyperparameter search.
2. Histogram gradient boosting with fixed settings: max depth 3, learning rate 0.05, 150 boosting iterations, L2 regularization 1.0, fixed random seed.

Target: direction of the five-minute future mid-price move.

## Confidence threshold calibration

Candidate probability thresholds are fixed in advance:

`0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.65, 0.70`

For each model, choose exactly one threshold on August calibration data only by highest mean executable net return after 8 bps fees, subject to at least 50 non-overlapping trades.

The chosen threshold is then frozen before September–December holdout evaluation.

## Primary gate

A model passes this pilot holdout only if September–December has:

- at least 200 non-overlapping trades;
- mean executable net return after 8 bps > 0;
- net profit factor > 1;
- gross executable mean return > 8 bps;
- same direction of economic edge as calibration.

Also report ROC-AUC, Brier score, gross/net return, win rate, profit factor and daily-block bootstrap 95% CI of mean net return.

## Interpretation

- If neither model passes, do not infer that all microstructure alpha is impossible; this sampled-day pilot falsifies this feature/model formulation and informs the next data/model iteration.
- If a model passes, do not open 2024. First rerun the frozen pipeline over every eligible June–December 2023 day.
- Jev remains excluded until a quantitative baseline establishes economically meaningful pre-Jev signal.