import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { BookTickerEvent, MarketDataEvent, TradeEvent } from '../types.js';

const SOURCE = 'binance-usdm' as const;

export function parseBinanceVisionAggTradeLine(
  line: string,
  symbol: string,
): TradeEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const columns = trimmed.split(',');
  const first = columns[0]?.trim().toLowerCase();
  if (first === undefined || first.includes('agg_trade') || first.includes('aggregate')) return null;
  if (columns.length < 7) throw new Error(`invalid aggTrades row: ${line}`);

  const aggregateTradeId = parseFiniteInteger(columns[0], 'aggregateTradeId');
  const price = parsePositiveNumber(columns[1], 'price');
  const quantity = parsePositiveNumber(columns[2], 'quantity');
  const timestamp = parseFiniteInteger(columns[5], 'timestamp');
  const buyerMaker = parseBoolean(columns[6], 'isBuyerMaker');

  return {
    type: 'trade',
    source: SOURCE,
    symbol: symbol.toUpperCase(),
    eventTime: timestamp,
    transactionTime: timestamp,
    receivedAt: timestamp,
    aggregateTradeId,
    price,
    quantity,
    aggressorSide: buyerMaker ? 'sell' : 'buy',
  };
}

export function parseBinanceVisionBookTickerLine(
  line: string,
  symbol: string,
): BookTickerEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const columns = trimmed.split(',');
  const first = columns[0]?.trim().toLowerCase();
  if (first === undefined || first.includes('update_id') || first.includes('updateid')) return null;
  if (columns.length < 7) throw new Error(`invalid bookTicker row: ${line}`);

  const updateId = parseFiniteInteger(columns[0], 'updateId');
  const bidPrice = parsePositiveNumber(columns[1], 'bidPrice');
  const bidQuantity = parsePositiveNumber(columns[2], 'bidQuantity');
  const askPrice = parsePositiveNumber(columns[3], 'askPrice');
  const askQuantity = parsePositiveNumber(columns[4], 'askQuantity');
  const transactionTime = parseFiniteInteger(columns[5], 'transactionTime');
  const eventTime = parseFiniteInteger(columns[6], 'eventTime');

  return {
    type: 'book_ticker',
    source: SOURCE,
    symbol: symbol.toUpperCase(),
    eventTime,
    transactionTime,
    receivedAt: eventTime,
    updateId,
    bidPrice,
    bidQuantity,
    askPrice,
    askQuantity,
  };
}

export async function* readBinanceVisionAggTrades(
  path: string,
  symbol: string,
): AsyncGenerator<MarketDataEvent> {
  for await (const line of readLines(path)) {
    const event = parseBinanceVisionAggTradeLine(line, symbol);
    if (event !== null) yield event;
  }
}

export async function* readBinanceVisionBookTicker(
  path: string,
  symbol: string,
): AsyncGenerator<MarketDataEvent> {
  for await (const line of readLines(path)) {
    const event = parseBinanceVisionBookTickerLine(line, symbol);
    if (event !== null) yield event;
  }
}

export function binanceVisionArchiveUrl(options: {
  dataset: 'aggTrades' | 'bookTicker';
  symbol: string;
  date: string;
  cadence?: 'daily' | 'monthly';
}): string {
  const symbol = options.symbol.toUpperCase();
  const cadence = options.cadence ?? (options.dataset === 'bookTicker' ? 'daily' : 'monthly');
  if (options.dataset === 'bookTicker' && cadence !== 'daily') {
    throw new Error('Binance Vision bookTicker archives are daily');
  }
  const suffix = options.dataset === 'aggTrades' ? 'aggTrades' : 'bookTicker';
  return `https://data.binance.vision/data/futures/um/${cadence}/${options.dataset}/${symbol}/${symbol}-${suffix}-${options.date}.zip`;
}

async function* readLines(path: string): AsyncGenerator<string> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
    input.destroy();
  }
}

function parsePositiveNumber(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${label}: ${value ?? ''}`);
  return parsed;
}

function parseFiniteInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid ${label}: ${value ?? ''}`);
  return parsed;
}

function parseBoolean(value: string | undefined, label: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`invalid ${label}: ${value ?? ''}`);
}
