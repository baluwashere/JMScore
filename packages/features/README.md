# JMScore feature engine

`features-v001` is deterministic and designed to run identically on live and historical market-state snapshots.

## Features

Trade-derived:
- returns: 15s, 30s, 1m, 3m, 5m, 15m
- 1m aggressor-volume imbalance
- 1m volume z-score vs 20 previous non-overlapping 1m buckets
- realized volatility: 1m, 5m, 15m using 1-second last-trade sampling and square-root sum of squared log returns

L1 / book-derived:
- L1 book imbalance from exact best bid/ask quantities
- L5 and L20 depth imbalance when a fresh top-20 book exists
- spread in basis points
- microprice minus midpoint in basis points

Derivatives:
- funding rate when fresh mark-price data exists
- open interest when fresh OI data exists

## Fail-closed rules

Every feature has an explicit availability flag. Missing history, stale feeds, unavailable historical depth, or statistically undefined calculations return `null` plus an unavailable reason. Missing values are never replaced by zero.

Historical Binance Vision `aggTrades + bookTicker` can therefore produce trade features and exact L1 features while L5/L20 remain unavailable. This is intentional.

## No look-ahead

The engine only uses trades with `eventTime <= asOf`. Tests inject future trades and require an identical feature vector to the baseline snapshot.

## Versioning

Any formula or semantic change requires a new immutable feature version (`features-v002`, etc.). Historical experiments must always record the version used.
