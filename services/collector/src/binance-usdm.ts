import {
  aggTradeSchema,
  bookTickerSchema,
  combinedEnvelopeSchema,
  markPriceSchema,
  openInterestSchema,
  partialDepthSchema,
} from './binance-schemas.js';
import { ManagedWebSocket, type SocketStatus } from './managed-websocket.js';
import type {
  CollectorHealth,
  EventListener,
  FeedFreshness,
  FeedName,
  HealthListener,
  MarketDataAdapter,
  MarketDataEvent,
  PriceLevel,
} from './types.js';

const SOURCE = 'binance-usdm' as const;

const freshnessThresholds: Record<FeedName, number> = {
  trade: 10_000,
  book: 2_000,
  book_ticker: 2_000,
  mark_price: 5_000,
  open_interest: 30_000,
};

export interface BinanceUsdmOptions {
  symbol?: string;
  openInterestPollMs?: number;
  healthIntervalMs?: number;
}

export interface BinanceUsdmUrls {
  publicUrl: string;
  marketUrl: string;
  openInterestUrl: string;
}

export function buildBinanceUsdmUrls(symbol: string): BinanceUsdmUrls {
  const upper = symbol.toUpperCase();
  const lower = symbol.toLowerCase();
  const publicStreams = [
    `${lower}@aggTrade`,
    `${lower}@depth20@100ms`,
    `${lower}@bookTicker`,
  ].join('/');

  return {
    publicUrl: `wss://fstream.binance.com/public/stream?streams=${publicStreams}`,
    marketUrl: `wss://fstream.binance.com/market/stream?streams=${lower}@markPrice@1s`,
    openInterestUrl: `https://fapi.binance.com/fapi/v1/openInterest?symbol=${upper}`,
  };
}

export class BinanceUsdmAdapter implements MarketDataAdapter {
  private readonly symbol: string;
  private readonly urls: BinanceUsdmUrls;
  private readonly openInterestPollMs: number;
  private readonly healthIntervalMs: number;
  private readonly eventListeners = new Set<EventListener>();
  private readonly healthListeners = new Set<HealthListener>();
  private readonly lastReceivedAt = new Map<FeedName, number>();

  private publicSocket: ManagedWebSocket | null = null;
  private marketSocket: ManagedWebSocket | null = null;
  private openInterestTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private openInterestInFlight = false;
  private running = false;
  private publicSocketConnected = false;
  private marketSocketConnected = false;
  private lastError: string | null = null;

  constructor(options: BinanceUsdmOptions = {}) {
    this.symbol = (options.symbol ?? 'BTCUSDT').toUpperCase();
    this.urls = buildBinanceUsdmUrls(this.symbol);
    this.openInterestPollMs = options.openInterestPollMs ?? 10_000;
    this.healthIntervalMs = options.healthIntervalMs ?? 5_000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.publicSocket = new ManagedWebSocket({
      name: 'binance-usdm-public',
      url: this.urls.publicUrl,
      staleAfterMs: 15_000,
      onMessage: (payload) => this.handlePublicMessage(payload),
      onStatus: (status) => this.handleSocketStatus('public', status),
      onError: (message) => this.recordError(message),
    });

    this.marketSocket = new ManagedWebSocket({
      name: 'binance-usdm-market',
      url: this.urls.marketUrl,
      staleAfterMs: 10_000,
      onMessage: (payload) => this.handleMarketMessage(payload),
      onStatus: (status) => this.handleSocketStatus('market', status),
      onError: (message) => this.recordError(message),
    });

    this.publicSocket.start();
    this.marketSocket.start();

    await this.pollOpenInterest();
    this.openInterestTimer = setInterval(() => void this.pollOpenInterest(), this.openInterestPollMs);
    this.healthTimer = setInterval(() => this.emitHealth(), this.healthIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.publicSocket?.stop();
    this.marketSocket?.stop();
    this.publicSocket = null;
    this.marketSocket = null;

    if (this.openInterestTimer) clearInterval(this.openInterestTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.openInterestTimer = null;
    this.healthTimer = null;
    this.publicSocketConnected = false;
    this.marketSocketConnected = false;
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onHealth(listener: HealthListener): () => void {
    this.healthListeners.add(listener);
    return () => this.healthListeners.delete(listener);
  }

  private handlePublicMessage(payload: string): void {
    try {
      const parsed = combinedEnvelopeSchema.parse(JSON.parse(payload));
      const receivedAt = Date.now();

      if (parsed.stream.endsWith('@aggTrade')) {
        const data = aggTradeSchema.parse(parsed.data);
        if (!this.isUsdm(data.st)) return;
        this.emitEvent({
          type: 'trade',
          source: SOURCE,
          symbol: data.s,
          eventTime: data.E,
          transactionTime: data.T,
          receivedAt,
          aggregateTradeId: data.a,
          price: Number(data.p),
          quantity: Number(data.q),
          aggressorSide: data.m ? 'sell' : 'buy',
        });
        return;
      }

      if (parsed.stream.includes('@depth20@')) {
        const data = partialDepthSchema.parse(parsed.data);
        if (!this.isUsdm(data.st)) return;
        this.emitEvent({
          type: 'book',
          source: SOURCE,
          symbol: data.s,
          eventTime: data.E,
          transactionTime: data.T,
          receivedAt,
          firstUpdateId: data.U,
          finalUpdateId: data.u,
          previousFinalUpdateId: data.pu,
          bids: this.toLevels(data.b),
          asks: this.toLevels(data.a),
        });
        return;
      }

      if (parsed.stream.endsWith('@bookTicker')) {
        const data = bookTickerSchema.parse(parsed.data);
        if (!this.isUsdm(data.st)) return;
        this.emitEvent({
          type: 'book_ticker',
          source: SOURCE,
          symbol: data.s,
          eventTime: data.E,
          transactionTime: data.T,
          receivedAt,
          updateId: data.u,
          bidPrice: Number(data.b),
          bidQuantity: Number(data.B),
          askPrice: Number(data.a),
          askQuantity: Number(data.A),
        });
      }
    } catch (error) {
      this.recordError(`public payload rejected: ${this.errorMessage(error)}`);
    }
  }

  private handleMarketMessage(payload: string): void {
    try {
      const parsed = combinedEnvelopeSchema.parse(JSON.parse(payload));
      if (!parsed.stream.includes('@markPrice')) return;

      const data = markPriceSchema.parse(parsed.data);
      if (!this.isUsdm(data.st)) return;
      const event: MarketDataEvent = {
        type: 'mark_price',
        source: SOURCE,
        symbol: data.s,
        eventTime: data.E,
        receivedAt: Date.now(),
        markPrice: Number(data.p),
        indexPrice: Number(data.i),
        fundingRate: Number(data.r),
        nextFundingTime: data.T,
        ...(data.P !== undefined ? { estimatedSettlePrice: Number(data.P) } : {}),
        ...(data.ap !== undefined ? { movingAveragePrice: Number(data.ap) } : {}),
      };
      this.emitEvent(event);
    } catch (error) {
      this.recordError(`market payload rejected: ${this.errorMessage(error)}`);
    }
  }

  private async pollOpenInterest(): Promise<void> {
    if (!this.running || this.openInterestInFlight) return;
    this.openInterestInFlight = true;

    try {
      const response = await fetch(this.urls.openInterestUrl, {
        signal: AbortSignal.timeout(8_000),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = openInterestSchema.parse(await response.json());
      this.emitEvent({
        type: 'open_interest',
        source: SOURCE,
        symbol: data.symbol,
        eventTime: data.time,
        receivedAt: Date.now(),
        openInterest: Number(data.openInterest),
      });
    } catch (error) {
      this.recordError(`open interest poll failed: ${this.errorMessage(error)}`);
    } finally {
      this.openInterestInFlight = false;
    }
  }

  private emitEvent(event: MarketDataEvent): void {
    this.lastReceivedAt.set(event.type, event.receivedAt);
    for (const listener of this.eventListeners) listener(event);
  }

  private emitHealth(): void {
    const now = Date.now();
    const feedNames = Object.keys(freshnessThresholds) as FeedName[];
    const feeds = {} as Record<FeedName, FeedFreshness>;

    for (const feed of feedNames) {
      const last = this.lastReceivedAt.get(feed) ?? null;
      const ageMs = last === null ? null : now - last;
      feeds[feed] = {
        feed,
        lastReceivedAt: last,
        ageMs,
        staleAfterMs: freshnessThresholds[feed],
        stale: ageMs === null || ageMs > freshnessThresholds[feed],
      };
    }

    const health: CollectorHealth = {
      type: 'health',
      source: SOURCE,
      symbol: this.symbol,
      checkedAt: now,
      publicSocketConnected: this.publicSocketConnected,
      marketSocketConnected: this.marketSocketConnected,
      feeds,
      lastError: this.lastError,
    };

    for (const listener of this.healthListeners) listener(health);
  }

  private handleSocketStatus(kind: 'public' | 'market', status: SocketStatus): void {
    if (kind === 'public') this.publicSocketConnected = status.connected;
    else this.marketSocketConnected = status.connected;

    if (!status.connected && status.reason) {
      this.recordError(`${status.name} disconnected: ${status.reason}`);
    }
  }

  private recordError(message: string): void {
    this.lastError = message;
  }

  private isUsdm(symbolType: number | undefined): boolean {
    return symbolType === undefined || symbolType === 1;
  }

  private toLevels(levels: Array<[string, string]>): PriceLevel[] {
    return levels.map(([price, quantity]) => ({
      price: Number(price),
      quantity: Number(quantity),
    }));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
