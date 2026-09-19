import {
  FEATURE_NAMES,
  type FeatureAvailability,
  type FeatureMarketSnapshot,
  type FeatureName,
  type FeatureUnavailableReasons,
  type FeatureValues,
  type FeatureVector,
  type FeatureTrade,
} from './types.js';

const FEATURE_VERSION = 'features-v001' as const;
const SECOND = 1_000;
const MINUTE = 60_000;

const RETURN_WINDOWS: ReadonlyArray<readonly [FeatureName, number]> = [
  ['return_15s', 15 * SECOND],
  ['return_30s', 30 * SECOND],
  ['return_1m', MINUTE],
  ['return_3m', 3 * MINUTE],
  ['return_5m', 5 * MINUTE],
  ['return_15m', 15 * MINUTE],
];

const VOL_WINDOWS: ReadonlyArray<readonly [FeatureName, number]> = [
  ['realized_vol_1m', MINUTE],
  ['realized_vol_5m', 5 * MINUTE],
  ['realized_vol_15m', 15 * MINUTE],
];

export interface FeatureEngineOptions {
  anchorToleranceMs?: number;
  realizedVolSampleMs?: number;
  volumeZScoreLookbackBuckets?: number;
}

export class FeatureEngine {
  private readonly anchorToleranceMs: number;
  private readonly realizedVolSampleMs: number;
  private readonly volumeZScoreLookbackBuckets: number;

  constructor(options: FeatureEngineOptions = {}) {
    this.anchorToleranceMs = options.anchorToleranceMs ?? 5_000;
    this.realizedVolSampleMs = options.realizedVolSampleMs ?? SECOND;
    this.volumeZScoreLookbackBuckets = options.volumeZScoreLookbackBuckets ?? 20;
  }

  compute(snapshot: FeatureMarketSnapshot): FeatureVector {
    const values = emptyValues();
    const availability = emptyAvailability();
    const unavailableReasons: FeatureUnavailableReasons = {};

    const trades = [...snapshot.trades].sort((a, b) => a.eventTime - b.eventTime);
    const referenceTrade = lastTradeAtOrBefore(trades, snapshot.asOf);
    const tradeFeedUsable = snapshot.feeds.trade.available && !snapshot.feeds.trade.stale;
    const referencePrice = tradeFeedUsable && referenceTrade !== null ? referenceTrade.price : null;

    for (const [feature, windowMs] of RETURN_WINDOWS) {
      if (!tradeFeedUsable || referenceTrade === null) {
        markUnavailable(availability, unavailableReasons, feature, 'fresh trade feed required');
        continue;
      }
      const anchor = anchorTrade(trades, snapshot.asOf - windowMs, this.anchorToleranceMs);
      if (anchor === null) {
        markUnavailable(availability, unavailableReasons, feature, `missing trade anchor for ${windowMs}ms window`);
        continue;
      }
      setFeature(values, availability, feature, referenceTrade.price / anchor.price - 1);
    }

    this.computeVolumeFeatures(snapshot, trades, values, availability, unavailableReasons);
    this.computeBookFeatures(snapshot, values, availability, unavailableReasons);
    this.computeVolatilityFeatures(snapshot, trades, values, availability, unavailableReasons);
    this.computeDerivativeFeatures(snapshot, values, availability, unavailableReasons);

    return {
      featureVersion: FEATURE_VERSION,
      symbol: snapshot.symbol,
      asOf: snapshot.asOf,
      referencePrice,
      values,
      availability,
      unavailableReasons,
    };
  }

  private computeVolumeFeatures(
    snapshot: FeatureMarketSnapshot,
    trades: readonly FeatureTrade[],
    values: FeatureValues,
    availability: FeatureAvailability,
    reasons: FeatureUnavailableReasons,
  ): void {
    if (!snapshot.feeds.trade.available || snapshot.feeds.trade.stale) {
      markUnavailable(availability, reasons, 'volume_imbalance_1m', 'fresh trade feed required');
      markUnavailable(availability, reasons, 'volume_zscore_1m', 'fresh trade feed required');
      return;
    }

    const oneMinuteStart = snapshot.asOf - MINUTE;
    if (!hasWindowCoverage(trades, oneMinuteStart, this.anchorToleranceMs)) {
      markUnavailable(availability, reasons, 'volume_imbalance_1m', 'insufficient 1m trade history');
    } else {
      const windowTrades = tradesInWindow(trades, oneMinuteStart, snapshot.asOf);
      const buyVolume = sumQuantity(windowTrades, 'buy');
      const sellVolume = sumQuantity(windowTrades, 'sell');
      const total = buyVolume + sellVolume;
      if (total <= 0) {
        markUnavailable(availability, reasons, 'volume_imbalance_1m', 'zero 1m traded volume');
      } else {
        setFeature(values, availability, 'volume_imbalance_1m', (buyVolume - sellVolume) / total);
      }
    }

    const zscoreLookbackMs = (this.volumeZScoreLookbackBuckets + 1) * MINUTE;
    const zscoreStart = snapshot.asOf - zscoreLookbackMs;
    if (!hasWindowCoverage(trades, zscoreStart, this.anchorToleranceMs)) {
      markUnavailable(availability, reasons, 'volume_zscore_1m', 'insufficient volume z-score history');
      return;
    }

    const bucketVolumes: number[] = [];
    for (let offset = this.volumeZScoreLookbackBuckets; offset >= 1; offset -= 1) {
      const bucketEnd = snapshot.asOf - offset * MINUTE;
      const bucketStart = bucketEnd - MINUTE;
      bucketVolumes.push(sumQuantity(tradesInWindow(trades, bucketStart, bucketEnd)));
    }
    const currentVolume = sumQuantity(tradesInWindow(trades, oneMinuteStart, snapshot.asOf));
    const mean = average(bucketVolumes);
    const std = standardDeviationPopulation(bucketVolumes, mean);
    const zscore = std === 0 ? 0 : (currentVolume - mean) / std;
    setFeature(values, availability, 'volume_zscore_1m', zscore);
  }

  private computeBookFeatures(
    snapshot: FeatureMarketSnapshot,
    values: FeatureValues,
    availability: FeatureAvailability,
    reasons: FeatureUnavailableReasons,
  ): void {
    const tickerUsable = snapshot.feeds.book_ticker.available && !snapshot.feeds.book_ticker.stale && snapshot.bookTicker !== null;
    if (!tickerUsable || snapshot.bookTicker === null) {
      for (const feature of ['book_imbalance_l1', 'spread_bps', 'microprice_delta_bps'] as const) {
        markUnavailable(availability, reasons, feature, 'fresh book ticker required');
      }
    } else {
      const ticker = snapshot.bookTicker;
      const qtyTotal = ticker.bidQuantity + ticker.askQuantity;
      if (qtyTotal <= 0) {
        markUnavailable(availability, reasons, 'book_imbalance_l1', 'invalid L1 quantity total');
        markUnavailable(availability, reasons, 'microprice_delta_bps', 'invalid L1 quantity total');
      } else {
        setFeature(
          values,
          availability,
          'book_imbalance_l1',
          (ticker.bidQuantity - ticker.askQuantity) / qtyTotal,
        );
        const mid = (ticker.bidPrice + ticker.askPrice) / 2;
        const microprice =
          (ticker.askPrice * ticker.bidQuantity + ticker.bidPrice * ticker.askQuantity) / qtyTotal;
        setFeature(values, availability, 'microprice_delta_bps', ((microprice - mid) / mid) * 10_000);
      }

      const mid = (ticker.bidPrice + ticker.askPrice) / 2;
      setFeature(values, availability, 'spread_bps', ((ticker.askPrice - ticker.bidPrice) / mid) * 10_000);
    }

    const bookUsable = snapshot.feeds.book.available && !snapshot.feeds.book.stale && snapshot.book !== null;
    if (!bookUsable || snapshot.book === null) {
      markUnavailable(availability, reasons, 'book_imbalance_l5', 'fresh top-20 book required');
      markUnavailable(availability, reasons, 'book_imbalance_l20', 'fresh top-20 book required');
      return;
    }

    const l5 = bookImbalance(snapshot.book.bids, snapshot.book.asks, 5);
    const l20 = bookImbalance(snapshot.book.bids, snapshot.book.asks, 20);
    if (l5 === null) markUnavailable(availability, reasons, 'book_imbalance_l5', 'insufficient L5 depth');
    else setFeature(values, availability, 'book_imbalance_l5', l5);
    if (l20 === null) markUnavailable(availability, reasons, 'book_imbalance_l20', 'insufficient L20 depth');
    else setFeature(values, availability, 'book_imbalance_l20', l20);
  }

  private computeVolatilityFeatures(
    snapshot: FeatureMarketSnapshot,
    trades: readonly FeatureTrade[],
    values: FeatureValues,
    availability: FeatureAvailability,
    reasons: FeatureUnavailableReasons,
  ): void {
    if (!snapshot.feeds.trade.available || snapshot.feeds.trade.stale) {
      for (const [feature] of VOL_WINDOWS) markUnavailable(availability, reasons, feature, 'fresh trade feed required');
      return;
    }

    for (const [feature, windowMs] of VOL_WINDOWS) {
      const start = snapshot.asOf - windowMs;
      if (!hasWindowCoverage(trades, start, this.anchorToleranceMs)) {
        markUnavailable(availability, reasons, feature, `insufficient ${windowMs}ms trade history`);
        continue;
      }
      const prices = sampleTradePrices(trades, start, snapshot.asOf, this.realizedVolSampleMs, this.anchorToleranceMs);
      if (prices.length < 2) {
        markUnavailable(availability, reasons, feature, 'insufficient sampled prices');
        continue;
      }
      setFeature(values, availability, feature, realizedVolatility(prices));
    }
  }

  private computeDerivativeFeatures(
    snapshot: FeatureMarketSnapshot,
    values: FeatureValues,
    availability: FeatureAvailability,
    reasons: FeatureUnavailableReasons,
  ): void {
    if (snapshot.feeds.mark_price.available && !snapshot.feeds.mark_price.stale && snapshot.markPrice !== null) {
      setFeature(values, availability, 'funding_rate', snapshot.markPrice.fundingRate);
    } else {
      markUnavailable(availability, reasons, 'funding_rate', 'fresh mark-price feed unavailable');
    }

    if (snapshot.feeds.open_interest.available && !snapshot.feeds.open_interest.stale && snapshot.openInterest !== null) {
      setFeature(values, availability, 'open_interest', snapshot.openInterest.openInterest);
    } else {
      markUnavailable(availability, reasons, 'open_interest', 'fresh open-interest feed unavailable');
    }
  }
}

function emptyValues(): FeatureValues {
  return Object.fromEntries(FEATURE_NAMES.map((name) => [name, null])) as FeatureValues;
}

function emptyAvailability(): FeatureAvailability {
  return Object.fromEntries(FEATURE_NAMES.map((name) => [name, false])) as FeatureAvailability;
}

function setFeature(
  values: FeatureValues,
  availability: FeatureAvailability,
  feature: FeatureName,
  value: number,
): void {
  if (!Number.isFinite(value)) throw new Error(`non-finite feature produced: ${feature}`);
  values[feature] = value;
  availability[feature] = true;
}

function markUnavailable(
  availability: FeatureAvailability,
  reasons: FeatureUnavailableReasons,
  feature: FeatureName,
  reason: string,
): void {
  availability[feature] = false;
  reasons[feature] = reason;
}

function lastTradeAtOrBefore(trades: readonly FeatureTrade[], timestamp: number): FeatureTrade | null {
  for (let index = trades.length - 1; index >= 0; index -= 1) {
    const trade = trades[index];
    if (trade !== undefined && trade.eventTime <= timestamp) return trade;
  }
  return null;
}

function anchorTrade(
  trades: readonly FeatureTrade[],
  targetTimestamp: number,
  toleranceMs: number,
): FeatureTrade | null {
  const trade = lastTradeAtOrBefore(trades, targetTimestamp);
  if (trade === null) return null;
  return targetTimestamp - trade.eventTime <= toleranceMs ? trade : null;
}

function hasWindowCoverage(
  trades: readonly FeatureTrade[],
  startTimestamp: number,
  toleranceMs: number,
): boolean {
  if (trades.length === 0) return false;
  const first = trades[0];
  return first !== undefined && first.eventTime <= startTimestamp + toleranceMs;
}

function tradesInWindow(
  trades: readonly FeatureTrade[],
  startExclusive: number,
  endInclusive: number,
): FeatureTrade[] {
  return trades.filter((trade) => trade.eventTime > startExclusive && trade.eventTime <= endInclusive);
}

function sumQuantity(trades: readonly FeatureTrade[], side?: 'buy' | 'sell'): number {
  let total = 0;
  for (const trade of trades) {
    if (side === undefined || trade.aggressorSide === side) total += trade.quantity;
  }
  return total;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviationPopulation(values: readonly number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function bookImbalance(
  bids: readonly { quantity: number }[],
  asks: readonly { quantity: number }[],
  depth: number,
): number | null {
  if (bids.length < depth || asks.length < depth) return null;
  const bidQty = bids.slice(0, depth).reduce((sum, level) => sum + level.quantity, 0);
  const askQty = asks.slice(0, depth).reduce((sum, level) => sum + level.quantity, 0);
  const total = bidQty + askQty;
  return total > 0 ? (bidQty - askQty) / total : null;
}

function sampleTradePrices(
  trades: readonly FeatureTrade[],
  startTimestamp: number,
  endTimestamp: number,
  sampleMs: number,
  anchorToleranceMs: number,
): number[] {
  if (sampleMs <= 0) throw new Error('realizedVolSampleMs must be positive');
  const anchor = anchorTrade(trades, startTimestamp, anchorToleranceMs);
  if (anchor === null) return [];

  const prices: number[] = [anchor.price];
  let tradeIndex = trades.findIndex((trade) => trade.eventTime > startTimestamp);
  if (tradeIndex < 0) tradeIndex = trades.length;
  let lastPrice = anchor.price;

  for (let sampleTime = startTimestamp + sampleMs; sampleTime <= endTimestamp; sampleTime += sampleMs) {
    while (tradeIndex < trades.length) {
      const trade = trades[tradeIndex];
      if (trade === undefined || trade.eventTime > sampleTime) break;
      lastPrice = trade.price;
      tradeIndex += 1;
    }
    prices.push(lastPrice);
  }
  return prices;
}

function realizedVolatility(prices: readonly number[]): number {
  let sumSquaredLogReturns = 0;
  for (let index = 1; index < prices.length; index += 1) {
    const previous = prices[index - 1];
    const current = prices[index];
    if (previous === undefined || current === undefined || previous <= 0 || current <= 0) continue;
    const logReturn = Math.log(current / previous);
    sumSquaredLogReturns += logReturn * logReturn;
  }
  return Math.sqrt(sumSquaredLogReturns);
}
