import assert from 'node:assert/strict';
import test from 'node:test';

import { FeatureEngine } from './engine.js';
import type { FeatureMarketSnapshot, FeatureTrade } from './types.js';

const SECOND = 1_000;
const MINUTE = 60_000;
const AS_OF = 30 * MINUTE;

function buildTrades(): FeatureTrade[] {
  const trades: FeatureTrade[] = [];
  const start = AS_OF - 22 * MINUTE;
  for (let timestamp = start; timestamp <= AS_OF; timestamp += SECOND) {
    const secondsFromStart = (timestamp - start) / SECOND;
    const minutesAgo = Math.floor((AS_OF - timestamp) / MINUTE);
    const quantity = minutesAgo === 0 ? 2 : 1 + (minutesAgo % 5) * 0.1;
    const secondInMinute = Math.floor(timestamp / SECOND) % 60;
    trades.push({
      eventTime: timestamp,
      price: 100 + secondsFromStart * 0.01,
      quantity,
      aggressorSide: secondInMinute % 4 === 0 ? 'sell' : 'buy',
    });
  }
  return trades;
}

function levels(side: 'bid' | 'ask') {
  return Array.from({ length: 20 }, (_, index) => ({
    price: side === 'bid' ? 199.9 - index * 0.1 : 200.1 + index * 0.1,
    quantity: side === 'bid' ? 2 : 1,
  }));
}

function liveSnapshot(): FeatureMarketSnapshot {
  return {
    symbol: 'BTCUSDT',
    asOf: AS_OF,
    trades: buildTrades(),
    book: { bids: levels('bid'), asks: levels('ask') },
    bookTicker: {
      eventTime: AS_OF,
      bidPrice: 199.9,
      bidQuantity: 3,
      askPrice: 200.1,
      askQuantity: 1,
    },
    markPrice: { eventTime: AS_OF, fundingRate: 0.0001 },
    openInterest: { eventTime: AS_OF, openInterest: 12_345 },
    feeds: {
      trade: { available: true, stale: false },
      book: { available: true, stale: false },
      book_ticker: { available: true, stale: false },
      mark_price: { available: true, stale: false },
      open_interest: { available: true, stale: false },
    },
  };
}

function assertClose(actual: number | null, expected: number, tolerance = 1e-12): void {
  assert.notEqual(actual, null);
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `${actual} != ${expected}`);
}

test('computes deterministic momentum, volume, book, volatility and derivative features', () => {
  const snapshot = liveSnapshot();
  const result = new FeatureEngine().compute(snapshot);
  const trades = snapshot.trades;
  const currentPrice = trades[trades.length - 1]?.price;
  assert.notEqual(currentPrice, undefined);

  const anchor1m = trades.find((trade) => trade.eventTime === AS_OF - MINUTE)?.price;
  assert.notEqual(anchor1m, undefined);
  assertClose(result.values.return_1m, (currentPrice as number) / (anchor1m as number) - 1);

  assertClose(result.values.volume_imbalance_1m, 0.5);
  assert.equal(result.availability.volume_zscore_1m, true);
  assert.ok(Number.isFinite(result.values.volume_zscore_1m));

  assertClose(result.values.book_imbalance_l1, 0.5);
  assertClose(result.values.book_imbalance_l5, 1 / 3);
  assertClose(result.values.book_imbalance_l20, 1 / 3);
  assertClose(result.values.spread_bps, 10);
  assertClose(result.values.microprice_delta_bps, 2.5);

  assert.equal(result.availability.realized_vol_1m, true);
  assert.equal(result.availability.realized_vol_5m, true);
  assert.equal(result.availability.realized_vol_15m, true);
  assert.ok((result.values.realized_vol_5m ?? 0) > 0);

  assert.equal(result.values.funding_rate, 0.0001);
  assert.equal(result.values.open_interest, 12_345);
  assert.equal(result.referencePrice, currentPrice);
});

test('historical capability gaps remain explicitly unavailable instead of being fabricated', () => {
  const snapshot = liveSnapshot();
  snapshot.book = null;
  snapshot.markPrice = null;
  snapshot.openInterest = null;
  snapshot.feeds.book = { available: false, stale: false };
  snapshot.feeds.mark_price = { available: false, stale: false };
  snapshot.feeds.open_interest = { available: false, stale: false };

  const result = new FeatureEngine().compute(snapshot);

  assert.equal(result.availability.book_imbalance_l1, true);
  assert.equal(result.availability.spread_bps, true);
  assert.equal(result.availability.microprice_delta_bps, true);
  assert.equal(result.availability.book_imbalance_l5, false);
  assert.equal(result.availability.book_imbalance_l20, false);
  assert.equal(result.values.book_imbalance_l5, null);
  assert.equal(result.values.book_imbalance_l20, null);
  assert.equal(result.availability.funding_rate, false);
  assert.equal(result.availability.open_interest, false);
});

test('stale trades fail closed without suppressing independent L1 features', () => {
  const snapshot = liveSnapshot();
  snapshot.feeds.trade = { available: true, stale: true };

  const result = new FeatureEngine().compute(snapshot);

  assert.equal(result.referencePrice, null);
  assert.equal(result.availability.return_1m, false);
  assert.equal(result.availability.volume_imbalance_1m, false);
  assert.equal(result.availability.realized_vol_5m, false);
  assert.equal(result.availability.book_imbalance_l1, true);
  assert.equal(result.availability.spread_bps, true);
});

test('future trades cannot leak into features', () => {
  const baseline = liveSnapshot();
  const withFuture = liveSnapshot();
  withFuture.trades = [
    ...withFuture.trades,
    { eventTime: AS_OF + SECOND, price: 1_000_000, quantity: 1_000_000, aggressorSide: 'buy' },
  ];

  const engine = new FeatureEngine();
  assert.deepEqual(engine.compute(withFuture), engine.compute(baseline));
});

test('zero historical volume variance with a different current bucket is unavailable', () => {
  const snapshot = liveSnapshot();
  const start = AS_OF - 22 * MINUTE;
  snapshot.trades = Array.from({ length: 22 * 60 + 1 }, (_, index) => {
    const eventTime = start + index * SECOND;
    return {
      eventTime,
      price: 100 + index * 0.01,
      quantity: eventTime > AS_OF - MINUTE ? 2 : 1,
      aggressorSide: 'buy' as const,
    };
  });

  const result = new FeatureEngine().compute(snapshot);
  assert.equal(result.availability.volume_zscore_1m, false);
  assert.equal(result.values.volume_zscore_1m, null);
  assert.equal(result.unavailableReasons.volume_zscore_1m, 'zero historical volume variance');
});
