import type {
  BookSnapshotEvent,
  BookTickerEvent,
  FeedName,
  MarkPriceEvent,
  MarketDataEvent,
  OpenInterestEvent,
  TradeEvent,
} from '../types.js';
import type { MarketClock } from './clock.js';
import { TimeBoundedBuffer } from './time-bounded-buffer.js';

export interface MarketStateCapabilities {
  trades: boolean;
  bookL20: boolean;
  bookTicker: boolean;
  markPrice: boolean;
  openInterest: boolean;
}

export const LIVE_MARKET_CAPABILITIES: MarketStateCapabilities = {
  trades: true,
  bookL20: true,
  bookTicker: true,
  markPrice: true,
  openInterest: true,
};

export const HISTORICAL_CORE_CAPABILITIES: MarketStateCapabilities = {
  trades: true,
  bookL20: false,
  bookTicker: true,
  markPrice: false,
  openInterest: false,
};

export interface StateFeedStatus {
  feed: FeedName;
  available: boolean;
  lastEventTime: number | null;
  ageMs: number | null;
  staleAfterMs: number;
  stale: boolean;
}

export interface RollingMarketSnapshot {
  symbol: string;
  asOf: number;
  capabilities: MarketStateCapabilities;
  trades: readonly TradeEvent[];
  book: BookSnapshotEvent | null;
  bookTicker: BookTickerEvent | null;
  markPrice: MarkPriceEvent | null;
  openInterest: OpenInterestEvent | null;
  feeds: Record<FeedName, StateFeedStatus>;
  coreLiveReady: boolean;
  availableDataFresh: boolean;
  rejectedEvents: number;
  lastRejection: string | null;
}

export interface IngestResult {
  accepted: boolean;
  reason?: string;
}

export interface RollingMarketStateOptions {
  symbol: string;
  clock: MarketClock;
  capabilities?: MarketStateCapabilities;
  tradeWindowMs?: number;
  maxTradeEvents?: number;
  maxFutureSkewMs?: number;
}

const staleAfterMs: Record<FeedName, number> = {
  trade: 10_000,
  book: 2_000,
  book_ticker: 2_000,
  mark_price: 5_000,
  open_interest: 30_000,
};

const capabilityByFeed: Record<FeedName, keyof MarketStateCapabilities> = {
  trade: 'trades',
  book: 'bookL20',
  book_ticker: 'bookTicker',
  mark_price: 'markPrice',
  open_interest: 'openInterest',
};

const liveCoreFeeds: readonly FeedName[] = ['trade', 'book', 'book_ticker', 'mark_price'];

export class RollingMarketState {
  private readonly symbol: string;
  private readonly clock: MarketClock;
  private readonly capabilities: MarketStateCapabilities;
  private readonly tradeBuffer: TimeBoundedBuffer<TradeEvent>;
  private readonly maxFutureSkewMs: number;
  private readonly lastEventTime = new Map<FeedName, number>();

  private book: BookSnapshotEvent | null = null;
  private bookTicker: BookTickerEvent | null = null;
  private markPrice: MarkPriceEvent | null = null;
  private openInterest: OpenInterestEvent | null = null;
  private rejectedEvents = 0;
  private lastRejection: string | null = null;

  constructor(options: RollingMarketStateOptions) {
    this.symbol = options.symbol.toUpperCase();
    this.clock = options.clock;
    this.capabilities = { ...(options.capabilities ?? LIVE_MARKET_CAPABILITIES) };
    this.maxFutureSkewMs = options.maxFutureSkewMs ?? 5_000;
    this.tradeBuffer = new TimeBoundedBuffer<TradeEvent>(
      options.tradeWindowMs ?? 30 * 60_000,
      options.maxTradeEvents ?? 500_000,
      (trade) => trade.eventTime,
    );
  }

  ingest(event: MarketDataEvent): IngestResult {
    const now = this.clock.nowMs();
    this.tradeBuffer.prune(now);

    if (event.symbol.toUpperCase() !== this.symbol) {
      return this.reject(`symbol mismatch: ${event.symbol} != ${this.symbol}`);
    }
    if (!Number.isFinite(event.eventTime) || event.eventTime < 0) {
      return this.reject(`invalid event time for ${event.type}`);
    }
    if (event.eventTime > now + this.maxFutureSkewMs) {
      return this.reject(`future event rejected for ${event.type}: ${event.eventTime} > ${now}`);
    }

    const previousTime = this.lastEventTime.get(event.type);
    if (previousTime !== undefined && event.eventTime < previousTime) {
      return this.reject(
        `out-of-order ${event.type} event: ${event.eventTime} < ${previousTime}`,
      );
    }

    const validationError = this.validateEvent(event);
    if (validationError !== null) return this.reject(validationError);

    switch (event.type) {
      case 'trade':
        this.tradeBuffer.push(event, now);
        break;
      case 'book':
        this.book = cloneBook(event);
        break;
      case 'book_ticker':
        this.bookTicker = { ...event };
        break;
      case 'mark_price':
        this.markPrice = { ...event };
        break;
      case 'open_interest':
        this.openInterest = { ...event };
        break;
    }

    this.lastEventTime.set(event.type, event.eventTime);
    return { accepted: true };
  }

  snapshot(): RollingMarketSnapshot {
    const now = this.clock.nowMs();
    this.tradeBuffer.prune(now);

    const feeds = {} as Record<FeedName, StateFeedStatus>;
    const feedNames = Object.keys(staleAfterMs) as FeedName[];

    for (const feed of feedNames) {
      const available = this.capabilities[capabilityByFeed[feed]];
      const last = this.lastEventTime.get(feed) ?? null;
      const ageMs = last === null ? null : Math.max(0, now - last);
      feeds[feed] = {
        feed,
        available,
        lastEventTime: last,
        ageMs,
        staleAfterMs: staleAfterMs[feed],
        stale: available && (ageMs === null || ageMs > staleAfterMs[feed]),
      };
    }

    const coreLiveReady = liveCoreFeeds.every(
      (feed) => feeds[feed].available && !feeds[feed].stale,
    );
    const availableDataFresh = feedNames.every(
      (feed) => !feeds[feed].available || !feeds[feed].stale,
    );

    return {
      symbol: this.symbol,
      asOf: now,
      capabilities: { ...this.capabilities },
      trades: this.tradeBuffer.values().map((trade) => ({ ...trade })),
      book: this.book === null ? null : cloneBook(this.book),
      bookTicker: this.bookTicker === null ? null : { ...this.bookTicker },
      markPrice: this.markPrice === null ? null : { ...this.markPrice },
      openInterest: this.openInterest === null ? null : { ...this.openInterest },
      feeds,
      coreLiveReady,
      availableDataFresh,
      rejectedEvents: this.rejectedEvents,
      lastRejection: this.lastRejection,
    };
  }

  private validateEvent(event: MarketDataEvent): string | null {
    switch (event.type) {
      case 'trade':
        if (!positiveFinite(event.price) || !positiveFinite(event.quantity)) {
          return 'trade price/quantity must be positive and finite';
        }
        return null;
      case 'book':
        return validateBook(event);
      case 'book_ticker':
        if (
          !positiveFinite(event.bidPrice) ||
          !positiveFinite(event.askPrice) ||
          !positiveFinite(event.bidQuantity) ||
          !positiveFinite(event.askQuantity)
        ) {
          return 'book ticker values must be positive and finite';
        }
        if (event.bidPrice >= event.askPrice) return 'crossed book ticker rejected';
        return null;
      case 'mark_price':
        if (!positiveFinite(event.markPrice) || !positiveFinite(event.indexPrice)) {
          return 'mark/index price must be positive and finite';
        }
        if (!Number.isFinite(event.fundingRate)) return 'funding rate must be finite';
        return null;
      case 'open_interest':
        if (!Number.isFinite(event.openInterest) || event.openInterest < 0) {
          return 'open interest must be finite and non-negative';
        }
        return null;
    }
  }

  private reject(reason: string): IngestResult {
    this.rejectedEvents += 1;
    this.lastRejection = reason;
    return { accepted: false, reason };
  }
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validateBook(book: BookSnapshotEvent): string | null {
  if (book.bids.length === 0 || book.asks.length === 0) return 'empty order book rejected';
  if (book.bids.length > 20 || book.asks.length > 20) return 'order book exceeds top-20 contract';

  for (let index = 0; index < book.bids.length; index += 1) {
    const level = book.bids[index];
    if (level === undefined || !positiveFinite(level.price) || !positiveFinite(level.quantity)) {
      return 'invalid bid level';
    }
    const previous = book.bids[index - 1];
    if (previous !== undefined && previous.price < level.price) return 'bids are not descending';
  }

  for (let index = 0; index < book.asks.length; index += 1) {
    const level = book.asks[index];
    if (level === undefined || !positiveFinite(level.price) || !positiveFinite(level.quantity)) {
      return 'invalid ask level';
    }
    const previous = book.asks[index - 1];
    if (previous !== undefined && previous.price > level.price) return 'asks are not ascending';
  }

  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid === undefined || bestAsk === undefined || bestBid >= bestAsk) {
    return 'crossed or invalid order book rejected';
  }
  return null;
}

function cloneBook(book: BookSnapshotEvent): BookSnapshotEvent {
  return {
    ...book,
    bids: book.bids.map((level) => ({ ...level })),
    asks: book.asks.map((level) => ({ ...level })),
  };
}
