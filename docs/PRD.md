# JMScore — Jev Momentum Lab PRD

Version: 0.2

## Objective

Determine whether Jev adds statistically and economically meaningful predictive value to a deterministic short-horizon crypto momentum strategy.

JMScore is initially a research and paper-trading system, not a live-money trading bot.

Primary hypothesis:

> Given a structured quantitative representation of current market conditions, can Jev improve the decision of whether short-term momentum will persist sufficiently to overcome fees, spread and slippage?

Core comparison:

- naive momentum baseline;
- conventional quantitative/ML baseline;
- momentum filtered by Jev.

If Jev does not add out-of-sample net value, remove it.

## MVP asset and horizon

Initial asset: BTC perpetual market data.

Prediction horizons:

- 30 seconds;
- 1 minute;
- 5 minutes — primary;
- 15 minutes.

No leverage and no meaningful real capital during the research phase.

## Architecture

```text
Exchange websocket
      ↓
Rolling in-memory market state
      ↓
Deterministic feature engine
      ↓
Candidate detector
      ↓
Persist candidate/control snapshot → Turso
      ↓
Jev evaluation via Vercel AI Gateway
      ↓
Persist probabilities/decision
      ↓
Outcome worker
      ↓
Persist future market outcomes
      ↓
Research / baseline comparison
```

AI may influence trade selection. AI never controls portfolio risk.

## Data policy

Do not build a permanent tick database in v0.1.

Raw trades and order-book updates live in rolling memory buffers and are used to derive features. Persist only analytically useful states:

- feature snapshots;
- Jev evaluations;
- strategy signals;
- future outcomes;
- immutable experiment definitions;
- later, paper execution records.

This reduces writes, storage and noise while keeping the experiment reproducible.

## Sampling

Feature state updates continuously in memory.

Initial defaults:

- feature refresh: approximately 1 second;
- candidate check: every 5 seconds;
- candidate states: persisted;
- control states: random/periodic sample, initially about one per minute.

Control sampling is required to avoid recording only preselected momentum events.

## Features

Momentum:

- return 15s, 30s, 1m, 3m, 5m, 15m;
- later: velocity, acceleration, distance from VWAP/EMA.

Volume:

- buy/sell volume;
- volume imbalance;
- volume z-score.

Order book:

- spread in bps;
- L1/L5/L20 imbalance;
- microprice delta;
- later: book slope/depth.

Volatility:

- realized volatility 1m, 5m, 15m;
- volatility z-score.

Derivatives where available:

- funding;
- open-interest changes.

## Candidate engine

Jev should not evaluate arbitrary market states in the first experiment.

Illustrative long candidate:

```text
return_1m > 0
AND return_5m > 0
AND volume_imbalance > 0
AND book_imbalance > 0
```

Short candidate is the inverse.

Exact rules are versioned and frozen for each experiment.

## Jev market-state evaluation

Jev receives a compact structured state, not raw trade history.

Initial outputs:

- regime: uptrend/downtrend/range/volatile/unclear;
- probability of positive momentum persistence;
- probability of negative momentum persistence;
- probability of false breakout/reversal;
- trade quality score.

Every evaluation records:

- feature snapshot ID;
- timestamp;
- model/model version;
- prompt version;
- normalized probabilities;
- raw output;
- latency;
- estimated model cost where available.

If Jev fails, times out, or produces invalid output, the trading decision fails closed to `NO_TRADE`.

## Baselines

A Jev result is meaningless without competitors.

Required baselines:

1. frequency-matched random control;
2. naive momentum using the same candidate rule without Jev;
3. logistic regression on the same features;
4. gradient boosting only after adequate data volume exists.

## Outcome labels

Each persisted snapshot is labeled later with observed market outcomes:

- price and return after 30s;
- price and return after 1m;
- price and return after 5m;
- price and return after 15m;
- 5-minute maximum favorable excursion;
- 5-minute maximum adverse excursion.

Raw outcomes are immutable observations. Transaction costs are applied later by the experiment/backtest layer so historical labels are not coupled to a changing cost model.

## Economic evaluation

A strategy that works before costs but not after costs does not work.

Backtests must model:

- maker/taker fees;
- bid/ask spread;
- slippage;
- latency;
- funding where relevant.

Maintain optimistic, realistic and pessimistic cost scenarios. Primary conclusions use realistic assumptions.

## Primary metrics

Predictive:

- calibration / Brier score;
- ROC-AUC where appropriate;
- precision at confidence thresholds.

Economic:

- mean net return per trade;
- cumulative net PnL;
- profit factor;
- Sharpe/Sortino;
- max drawdown;
- turnover and trade frequency.

Core KPI:

```text
Jev alpha = net return(momentum + Jev) - net return(momentum baseline)
```

Measured out of sample.

## Confidence analysis

Jev confidence must be analyzed in buckets (for example 0.50–0.55 ... 0.95–1.00).

For each bucket record:

- N;
- win rate;
- gross return;
- net return under cost scenarios;
- profit factor;
- MFE;
- MAE.

The strongest useful signal would be a stable relationship where higher Jev confidence corresponds to higher future net return.

## Anti-overfitting

Never random-split financial time-series data.

Use chronological train/validation/test and then walk-forward evaluation.

Final holdout data remains untouched until strategy, feature and threshold rules are frozen.

Each experiment records immutable versions for:

- strategy;
- features;
- Jev prompt;
- model;
- transaction-cost model.

## Database

Use Turso/libSQL with Drizzle ORM.

v0.1 tables:

- `experiments`;
- `feature_snapshots`;
- `jev_evaluations`;
- `outcomes`;
- `strategy_signals`.

Paper execution tables are added only when the recorder/research phase works.

## Go / no-go gate

Do not advance to tiny-capital live testing unless Jev-filtered momentum:

- has positive out-of-sample PnL;
- remains positive after realistic transaction costs;
- beats the naive momentum baseline;
- remains useful across multiple market regimes;
- is not dependent on one short profit cluster;
- survives walk-forward evaluation;
- demonstrates incremental information in Jev confidence.

Otherwise stop, modify the hypothesis, or remove Jev.

## First deployable product

The first product is **Jev Momentum Recorder v0.1**.

It continuously produces:

```text
BTC market state
+ deterministic momentum candidate
+ Jev probabilities
+ future observed outcomes
```

The first hard question is:

> Does increasing Jev confidence predict increasing future net return after realistic costs?

Do not add real-money execution complexity until the recorder can answer that question credibly.
