import { BinanceUsdmAdapter } from './binance-usdm.js';
import type { FeedName, MarketDataEvent } from './types.js';

const expected = new Set<MarketDataEvent['type']>([
  'trade',
  'book',
  'book_ticker',
  'mark_price',
  'open_interest',
]);

const collector = new BinanceUsdmAdapter({ symbol: process.env.COLLECTOR_SYMBOL ?? 'BTCUSDT' });

const result = await new Promise<'ok' | 'timeout'>((resolve) => {
  const timeout = setTimeout(() => resolve('timeout'), 30_000);

  collector.onEvent((event) => {
    expected.delete(event.type);
    if (expected.size === 0) {
      clearTimeout(timeout);
      resolve('ok');
    }
  });

  void collector.start();
});

await collector.stop();

if (result === 'timeout') {
  const missing = [...expected] as FeedName[];
  console.error(JSON.stringify({ ok: false, missing }));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, received: 'all_required_feeds' }));
