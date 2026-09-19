import { BinanceUsdmAdapter } from './binance-usdm.js';
import type { CollectorHealth, MarketDataEvent } from './types.js';

const symbol = process.env.COLLECTOR_SYMBOL ?? 'BTCUSDT';
const collector = new BinanceUsdmAdapter({ symbol });

const counters: Record<MarketDataEvent['type'], number> = {
  trade: 0,
  book: 0,
  book_ticker: 0,
  mark_price: 0,
  open_interest: 0,
};

collector.onEvent((event) => {
  counters[event.type] += 1;
});

collector.onHealth((health: CollectorHealth) => {
  const staleFeeds = Object.values(health.feeds)
    .filter((feed) => feed.stale)
    .map((feed) => feed.feed);

  console.log(
    JSON.stringify({
      at: new Date(health.checkedAt).toISOString(),
      source: health.source,
      symbol: health.symbol,
      sockets: {
        public: health.publicSocketConnected,
        market: health.marketSocketConnected,
      },
      staleFeeds,
      counters,
      lastError: health.lastError,
    }),
  );
});

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ event: 'shutdown', signal }));
  await collector.stop();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

collector.start().catch((error: unknown) => {
  console.error('collector failed to start', error);
  process.exit(1);
});
