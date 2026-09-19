import assert from 'node:assert/strict';
import test from 'node:test';

import type { BookSnapshotEvent, BookTickerEvent, MarkPriceEvent, TradeEvent } from '../types.js';
import { ReplayMarketClock } from './clock.js';
import {
  HISTORICAL_CORE_CAPABILITIES,
  LIVE_MARKET_CAPABILITIES,
  RollingMarketState,
} from './rolling-market-state.js';

const symbol = 'BTCUSDT';

function trade(at: number, id = 1): TradeEvent {
  return {
    type: 'trade',
    source: 'binance-usdm',
    symbol,
    eventTime: at,
    transactionTime: at,
    receivedAt: at,
    aggregateTradeId: id,
    price: 100,
    quantity: 2,
    aggressorSide: 'buy',
  };
}

function ticker(at: number, bid = 99, ask = 101): BookTickerEvent {
  return {
    type: 'book_ticker',
    source: 'binance-usdm',
    symbol,
    eventTime: at,
    transactionTime: at,
    receivedAt: at,
    updateId: at,
    bidPrice: bid,
    bidQuantity: 3,
    askPrice: ask,
    askQuantity: 4,
  };
}

function book(at: number): BookSnapshotEvent {
  return {
    type: 'book',
    source: 'binance-usdm',
    symbol,
    eventTime: at,
    transactionTime: at,
    receivedAt: at,
    firstUpdateId: at,
    finalUpdateId: at,
    previousFinalUpdateId: Math.max(0, at - 1),
    bids: [
      { price: 99, quantity: 2 },
      { price: 98, quantity: 3 },
    ],
    asks: [
      { price: 101, quantity: 2 },
      { price: 102, quantity: 3 },
    ],
  };
}

function mark(at: number): MarkPriceEvent {
  return {
    type: 'mark_price',
    source: 'binance-usdm',
    symbol,
    eventTime: at,
    receivedAt: at,
    markPrice: 100,
    indexPrice: 100,
    fundingRate: 0.0001,
    nextFundingTime: at + 8 * 60 * 60_000,
  };
}

test('historical state prunes trades and distinguishes unavailable from stale feeds', () => {
  const clock = new ReplayMarketClock(1_000);
  const state = new RollingMarketState({
    symbol,
    clock,
    capabilities: HISTORICAL_CORE_CAPABILITIES,
    tradeWindowMs: 5_000,
  });

  assert.equal(state.ingest(trade(1_000)).accepted, true);
  assert.equal(state.ingest(ticker(1_000)).accepted, true);

  let snapshot = state.snapshot();
  assert.equal(snapshot.trades.length, 1);
  assert.equal(snapshot.feeds.book.available, false);
  assert.equal(snapshot.feeds.book.stale, false);
  assert.equal(snapshot.availableDataFresh, true);
  assert.equal(snapshot.coreLiveReady, false);

  clock.advanceTo(7_001);
  snapshot = state.snapshot();
  assert.equal(snapshot.trades.length, 0);
  assert.equal(snapshot.feeds.book_ticker.stale, true);
  assert.equal(snapshot.availableDataFresh, false);
});

test('state rejects crossed and out-of-order book ticker events', () => {
  const clock = new ReplayMarketClock(10_000);
  const state = new RollingMarketState({ symbol, clock, capabilities: HISTORICAL_CORE_CAPABILITIES });

  const crossed = state.ingest(ticker(10_000, 101, 100));
  assert.equal(crossed.accepted, false);
  assert.match(crossed.reason ?? '', /crossed/);

  assert.equal(state.ingest(ticker(10_000)).accepted, true);
  const older = state.ingest(ticker(9_999));
  assert.equal(older.accepted, false);
  assert.match(older.reason ?? '', /out-of-order/);
  assert.equal(state.snapshot().rejectedEvents, 2);
});

test('live core is ready only when all four core feeds are fresh', () => {
  const clock = new ReplayMarketClock(20_000);
  const state = new RollingMarketState({ symbol, clock, capabilities: LIVE_MARKET_CAPABILITIES });

  state.ingest(trade(20_000));
  state.ingest(book(20_000));
  state.ingest(ticker(20_000));
  state.ingest(mark(20_000));

  const snapshot = state.snapshot();
  assert.equal(snapshot.coreLiveReady, true);
  assert.equal(snapshot.availableDataFresh, false, 'OI is declared available but has not arrived');
});
