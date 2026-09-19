# T4E-BTC — frozen rare-move confirmation on unused 2023 days

This protocol is committed before opening any day not used by T4D.

## Hypothesis under confirmation

The only formulation carried forward from T4D is the suggestive but underpowered candidate:

- instrument: Binance USD-M BTCUSDT perpetual;
- features: the exact frozen 23-feature T4C/T4D microstructure vector;
- model family: `HistGradientBoostingClassifier`;
- long and short models trained separately;
- training data: exactly T4D `TRAIN_DATES` (1, 8, 15, 22 June and July 2023);
- target: executable five-minute net return after 8 bps round-trip taker fees `> 8 bps`;
- model hyperparameters: max depth 3, learning rate 0.05, 150 iterations, L2 1.0, seed 20230919;
- probability threshold: 0.80 for LONG and 0.80 for SHORT, frozen from T4D;
- one side per timestamp; if both cross threshold, choose the larger probability margin; exact ties are NO_TRADE;
- one five-minute position open at a time;
- entry/exit and freshness rules are unchanged from T4D.

No feature, hyperparameter, target barrier, fee, threshold or execution rule may be altered after this protocol is committed.

## Confirmation data

T4D used calendar days 1, 8, 15 and 22 of each month from June through December 2023.

T4E evaluates every other calendar day from 1 June through 31 December 2023 for which both official Binance Vision `aggTrades` and `bookTicker` daily archives are available. The T4D dates are explicitly excluded.

The **primary confirmatory set** is all unused days from September through December 2023. These dates are later than the T4D training and calibration periods.

Unused June–August dates are evaluated as a **secondary generalization set** and cannot rescue a failure of the primary confirmatory set.

2024 and 2025 remain unopened.

## Primary decision rule

The frozen formulation is `CONFIRMED_2023` only if the September–December unused-day set satisfies all of:

1. at least 100 non-overlapping trades;
2. mean executable net return after 8 bps fees > 0;
3. net profit factor > 1;
4. lower bound of a daily-block bootstrap 95% confidence interval for mean net return > 0.

If the point estimate is positive with PF > 1 but the bootstrap interval includes zero, the result is `INCONCLUSIVE_2023`.

Otherwise the result is `REJECTED_2023`.

## Required reporting

Report, without changing the decision rule:

- total and monthly trade counts;
- gross and net mean bps/trade;
- win rate and profit factor;
- daily-block bootstrap 95% CI;
- LONG and SHORT performance separately;
- monthly performance for September, October, November and December;
- model ROC-AUC/Brier/positive-label rate by month and side;
- data QA and any unavailable archive days.

No Jev calls are part of T4E. Jev remains shadow-only and is considered only after the quantitative formulation is confirmed.