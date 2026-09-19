export type AggressorSide = 'buy' | 'sell';

export interface FeatureTrade {
  eventTime: number;
  price: number;
  quantity: number;
  aggressorSide: AggressorSide;
}

export interface FeaturePriceLevel {
  price: number;
  quantity: number;
}

export interface FeatureBook {
  bids: readonly FeaturePriceLevel[];
  asks: readonly FeaturePriceLevel[];
}

export interface FeatureBookTicker {
  eventTime: number;
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
}

export interface FeatureMarkPrice {
  eventTime: number;
  fundingRate: number;
}

export interface FeatureOpenInterest {
  eventTime: number;
  openInterest: number;
}

export type FeatureFeedName = 'trade' | 'book' | 'book_ticker' | 'mark_price' | 'open_interest';

export interface FeatureFeedStatus {
  available: boolean;
  stale: boolean;
}

export interface FeatureMarketSnapshot {
  symbol: string;
  asOf: number;
  trades: readonly FeatureTrade[];
  book: FeatureBook | null;
  bookTicker: FeatureBookTicker | null;
  markPrice: FeatureMarkPrice | null;
  openInterest: FeatureOpenInterest | null;
  feeds: Record<FeatureFeedName, FeatureFeedStatus>;
}

export const FEATURE_NAMES = [
  'return_15s',
  'return_30s',
  'return_1m',
  'return_3m',
  'return_5m',
  'return_15m',
  'volume_imbalance_1m',
  'volume_zscore_1m',
  'book_imbalance_l1',
  'book_imbalance_l5',
  'book_imbalance_l20',
  'spread_bps',
  'microprice_delta_bps',
  'realized_vol_1m',
  'realized_vol_5m',
  'realized_vol_15m',
  'funding_rate',
  'open_interest',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export type FeatureValues = Record<FeatureName, number | null>;
export type FeatureAvailability = Record<FeatureName, boolean>;
export type FeatureUnavailableReasons = Partial<Record<FeatureName, string>>;

export interface FeatureVector {
  featureVersion: 'features-v001';
  symbol: string;
  asOf: number;
  referencePrice: number | null;
  values: FeatureValues;
  availability: FeatureAvailability;
  unavailableReasons: FeatureUnavailableReasons;
}
