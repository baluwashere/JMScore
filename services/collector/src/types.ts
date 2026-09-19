export type AggressorSide = 'buy' | 'sell';

export interface PriceLevel {
  price: number;
  quantity: number;
}

interface BaseMarketEvent {
  source: 'binance-usdm';
  symbol: string;
  eventTime: number;
  receivedAt: number;
}

export interface TradeEvent extends BaseMarketEvent {
  type: 'trade';
  transactionTime: number;
  aggregateTradeId: number;
  price: number;
  quantity: number;
  aggressorSide: AggressorSide;
}

export interface BookSnapshotEvent extends BaseMarketEvent {
  type: 'book';
  transactionTime: number;
  firstUpdateId: number;
  finalUpdateId: number;
  previousFinalUpdateId: number;
  bids: PriceLevel[];
  asks: PriceLevel[];
}

export interface BookTickerEvent extends BaseMarketEvent {
  type: 'book_ticker';
  transactionTime: number;
  updateId: number;
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
}

export interface MarkPriceEvent extends BaseMarketEvent {
  type: 'mark_price';
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  estimatedSettlePrice?: number;
  movingAveragePrice?: number;
}

export interface OpenInterestEvent {
  type: 'open_interest';
  source: 'binance-usdm';
  symbol: string;
  eventTime: number;
  receivedAt: number;
  openInterest: number;
}

export type MarketDataEvent =
  | TradeEvent
  | BookSnapshotEvent
  | BookTickerEvent
  | MarkPriceEvent
  | OpenInterestEvent;

export type FeedName = 'trade' | 'book' | 'book_ticker' | 'mark_price' | 'open_interest';

export interface FeedFreshness {
  feed: FeedName;
  lastReceivedAt: number | null;
  ageMs: number | null;
  staleAfterMs: number;
  stale: boolean;
}

export interface CollectorHealth {
  type: 'health';
  source: 'binance-usdm';
  symbol: string;
  checkedAt: number;
  publicSocketConnected: boolean;
  marketSocketConnected: boolean;
  feeds: Record<FeedName, FeedFreshness>;
  lastError: string | null;
  recentErrors: string[];
}

export type EventListener = (event: MarketDataEvent) => void;
export type HealthListener = (health: CollectorHealth) => void;

export interface MarketDataAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: EventListener): () => void;
  onHealth(listener: HealthListener): () => void;
}
