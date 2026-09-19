import { ReplayMarketClock } from '../state/clock.js';
import { RollingMarketState } from '../state/rolling-market-state.js';
import {
  readBinanceVisionAggTrades,
  readBinanceVisionBookTicker,
} from './binance-vision.js';
import { mergeSortedEventStreams, replayMarketEvents } from './replay.js';

interface CliArgs {
  symbol: string;
  aggTrades: string;
  bookTicker?: string;
  snapshotMs: number;
}

const args = parseArgs(process.argv.slice(2));
const capabilities = {
  trades: true,
  bookL20: false,
  bookTicker: args.bookTicker !== undefined,
  markPrice: false,
  openInterest: false,
};

const streams = [readBinanceVisionAggTrades(args.aggTrades, args.symbol)];
if (args.bookTicker !== undefined) {
  streams.push(readBinanceVisionBookTicker(args.bookTicker, args.symbol));
}

const clock = new ReplayMarketClock();
const state = new RollingMarketState({
  symbol: args.symbol,
  clock,
  capabilities,
});

let snapshotCount = 0;
const summary = await replayMarketEvents(mergeSortedEventStreams(streams), state, clock, {
  snapshotEveryMs: args.snapshotMs,
  onSnapshot: () => {
    snapshotCount += 1;
  },
});

const finalState = state.snapshot();
console.log(
  JSON.stringify(
    {
      ok: true,
      symbol: args.symbol,
      summary,
      snapshotCount,
      finalState: {
        asOf: finalState.asOf,
        capabilities: finalState.capabilities,
        tradesInRollingWindow: finalState.trades.length,
        latestBookTickerAt: finalState.bookTicker?.eventTime ?? null,
        availableDataFresh: finalState.availableDataFresh,
        rejectedEvents: finalState.rejectedEvents,
      },
    },
    null,
    2,
  ),
);

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      usage();
    }
    values.set(key, value);
  }

  const aggTrades = values.get('--agg-trades');
  if (aggTrades === undefined) usage();

  const snapshotMs = Number(values.get('--snapshot-ms') ?? '1000');
  if (!Number.isFinite(snapshotMs) || snapshotMs <= 0) {
    throw new Error('--snapshot-ms must be a positive number');
  }

  const result: CliArgs = {
    symbol: (values.get('--symbol') ?? 'BTCUSDT').toUpperCase(),
    aggTrades,
    snapshotMs,
  };
  const bookTicker = values.get('--book-ticker');
  if (bookTicker !== undefined) result.bookTicker = bookTicker;
  return result;
}

function usage(): never {
  throw new Error(
    'usage: replay --agg-trades <csv> [--book-ticker <csv>] [--symbol BTCUSDT] [--snapshot-ms 1000]',
  );
}
