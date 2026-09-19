import assert from 'node:assert/strict';
import test from 'node:test';

import type { MarketDataEvent } from '../types.js';
import { ReplayMarketClock } from '../state/clock.js';
import {
  HISTORICAL_CORE_CAPABILITIES,
  RollingMarketState,
} from '../state/rolling-market-state.js';
import {
  binanceVisionArchiveUrl,
  parseBinanceVisionAggTradeLine,
  parseBinanceVisionBookTickerLine,
} from './binance-vision.js';
import { mergeSortedEventStreams, replayMarketEvents } from './replay.js';

const symbol = 'BTCUSDT';

async function* events(values: readonly MarketDataEvent[]): AsyncGenerator<MarketDataEvent> {
  for (const value of values) yield value;
}

test('Binance Vision parsers normalize aggTrades and bookTicker rows', () => {
  const trade = parseBinanceVisionAggTradeLine(
    '26129,100.50,0.25,27781,27781,1600000000000,true',
    symbol,
  );
  assert.equal(trade?.type, 'trade');
  assert.equal(trade?.aggressorSide, 'sell');
  assert.equal(trade?.price, 100.5);

  const ticker = parseBinanceVisionBookTickerLine(
    '42,100.0,2.0,100.5,3.0,1600000000001,1600000000002',
    symbol,
  );
  assert.equal(ticker?.type, 'book_ticker');
  assert.equal(ticker?.eventTime, 1600000000002);
  assert.equal(ticker?.askPrice, 100.5);

  assert.equal(
    parseBinanceVisionAggTradeLine('agg_trade_id,price,qty,first_trade_id,last_trade_id,transact_time,is_buyer_maker', symbol),
    null,
  );
});

test('archive URL builder enforces daily bookTicker archives', () => {
  assert.equal(
    binanceVisionArchiveUrl({ dataset: 'aggTrades', symbol, date: '2025-01' }),
    'https://data.binance.vision/data/futures/um/monthly/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2025-01.zip',
  );
  assert.equal(
    binanceVisionArchiveUrl({ dataset: 'bookTicker', symbol, date: '2025-01-02' }),
    'https://data.binance.vision/data/futures/um/daily/bookTicker/BTCUSDT/BTCUSDT-bookTicker-2025-01-02.zip',
  );
  assert.throws(
    () => binanceVisionArchiveUrl({ dataset: 'bookTicker', symbol, date: '2025-01', cadence: 'monthly' }),
    /daily/,
  );
});

test('sorted streams replay deterministically through the same rolling state', async () => {
  const trade1 = parseBinanceVisionAggTradeLine('1,100,1,1,1,1000,false', symbol);
  const trade2 = parseBinanceVisionAggTradeLine('2,101,1,2,2,1002,true', symbol);
  const ticker = parseBinanceVisionBookTickerLine('3,100,2,101,2,1001,1001', symbol);
  assert.ok(trade1 !== null && trade2 !== null && ticker !== null);

  const merged = mergeSortedEventStreams([
    events([trade1, trade2]),
    events([ticker]),
  ]);
  const clock = new ReplayMarketClock();
  const state = new RollingMarketState({
    symbol,
    clock,
    capabilities: HISTORICAL_CORE_CAPABILITIES,
  });

  const snapshots: number[] = [];
  const summary = await replayMarketEvents(merged, state, clock, {
    snapshotEveryMs: 1,
    onSnapshot: (snapshot) => snapshots.push(snapshot.asOf),
  });

  assert.deepEqual(snapshots, [1000, 1001, 1002]);
  assert.deepEqual(summary, {
    eventsSeen: 3,
    eventsAccepted: 3,
    eventsRejected: 0,
    firstEventTime: 1000,
    lastEventTime: 1002,
    snapshotsEmitted: 3,
  });
  assert.equal(state.snapshot().trades.length, 2);
  assert.equal(state.snapshot().bookTicker?.eventTime, 1001);
});

test('replay refuses a non-monotonic merged stream', async () => {
  const first = parseBinanceVisionAggTradeLine('1,100,1,1,1,2000,false', symbol);
  const second = parseBinanceVisionAggTradeLine('2,100,1,2,2,1999,false', symbol);
  assert.ok(first !== null && second !== null);

  const clock = new ReplayMarketClock();
  const state = new RollingMarketState({ symbol, clock, capabilities: HISTORICAL_CORE_CAPABILITIES });
  await assert.rejects(
    replayMarketEvents(events([first, second]), state, clock),
    /not monotonic/,
  );
});
