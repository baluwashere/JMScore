# T4C — Microstructure + ML 2023 pilot result

Decision: **NO_GO_PILOT**

## Data

- BTCUSDT USD-M perpetual, Binance Vision official daily `aggTrades` + `bookTicker`.
- 2023 only; 2024 and 2025 were not loaded.
- Deterministically sampled days 1, 8, 15 and 22 from June through December.
- Train: June–July; calibration: August; untouched pilot holdout: September–December.
- Raw events processed: 25,030,092 aggregate trades and 327,195,005 book-ticker updates.
- Compressed source volume: 328,396,640 bytes aggTrades + 3,722,932,710 bytes bookTicker.
- Candidate 30-second snapshots: 79,800; usable: 79,176 (99.22%).
- Crossed BBO states accepted: 0.
- One sampled day (2023-09-22) had lower usable BBO coverage (2,230/2,850 snapshots); stale/missing states were rejected rather than filled beyond the freshness limit.

Dataset rows after feature/execution QA:
- train: 22,797
- calibration: 11,400
- holdout: 44,979

23 preregistered features were used: short-horizon returns/volatility, aggressor volume and count imbalances, flow acceleration, volume z-score, spread, L1 book imbalance, microprice delta and quote-update intensity.

## Execution semantics

- Decision every 30 seconds.
- Features use data available at or before decision time only.
- Entry at t+1s using executable BBO: long buys ask, short sells bid.
- Exit at t+301s: long sells bid, short buys ask.
- Spread is therefore embedded in gross return.
- Primary net result subtracts an additional 8 bps round-trip taker fees.
- Only one five-minute position may be open at a time.

## Results

| Model | Calibrated threshold | Holdout N | Holdout AUC | Gross mean bps | Net mean after 8 bps | Net win rate | Net PF | Daily-block bootstrap 95% CI net bps | Gate |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Logistic regression | 0.52 | 3,870 | 0.5253 | +0.417 | -7.583 | 17.05% | 0.149 | [-7.76, -7.40] | FAIL |
| Histogram gradient boosting | 0.65 | 2,329 | 0.5013 | -0.658 | -8.658 | 17.90% | 0.148 | [-9.17, -8.02] | FAIL |

### Predictive performance

Logistic regression ROC-AUC:
- train: 0.5509
- calibration: 0.5307
- holdout: 0.5253

Histogram gradient boosting ROC-AUC:
- train: 0.6463
- calibration: 0.5186
- holdout: 0.5013

The linear model retains a small directional signal out of sample, but its economic magnitude is far below transaction costs. The nonlinear model shows clear train-to-holdout deterioration and no holdout directional discrimination.

### Calibration did not contain an economic edge

The threshold was selected only on August. Even the best eligible calibration choices were already negative after costs:

- logistic threshold 0.52: N=971, gross +0.460 bps, net8 -7.540 bps, PF 0.094
- gradient boosting threshold 0.65: N=137, gross +0.804 bps, net8 -7.196 bps, PF 0.165

The gradient boosting 0.70 threshold showed +5.962 bps gross on only 15 non-overlapping calibration trades, below the preregistered minimum sample size and still -2.038 bps after fees; it was not eligible for selection.

## Interpretation

This pilot falsifies the current five-minute, taker-execution formulation of A+B. The failure is not caused only by spread: even before the additional 8 bps fee assumption, the holdout gross edge is +0.417 bps for logistic regression and negative for gradient boosting.

The logistic model's AUC above 0.5 suggests that microstructure contains some directional information, but predicting direction is not sufficient. The next rational experiment should target **rare moves large enough to pay costs**, rather than optimize generic up/down classification.

Do not introduce Jev yet. Do not open 2024 for this formulation. Any next model must be preregistered and remain inside 2023 until it demonstrates an economically meaningful edge.