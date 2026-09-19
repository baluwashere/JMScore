import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const experiments = sqliteTable(
  'experiments',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    name: text('name').notNull(),
    status: text('status', {
      enum: ['draft', 'running', 'frozen', 'completed', 'cancelled'],
    }).notNull(),
    strategyVersion: text('strategy_version').notNull(),
    featureVersion: text('feature_version').notNull(),
    promptVersion: text('prompt_version'),
    modelVersion: text('model_version'),
    costModelVersion: text('cost_model_version').notNull(),
    configurationJson: text('configuration_json').notNull(),
  },
  (table) => [index('experiments_status_created_at_idx').on(table.status, table.createdAt)],
);

export const featureSnapshots = sqliteTable(
  'feature_snapshots',
  {
    id: text('id').primaryKey(),
    experimentId: text('experiment_id').references(() => experiments.id),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    symbol: text('symbol').notNull(),
    sampleType: text('sample_type', { enum: ['candidate', 'control'] }).notNull(),
    price: real('price').notNull(),

    return15s: real('return_15s').notNull(),
    return30s: real('return_30s').notNull(),
    return1m: real('return_1m').notNull(),
    return3m: real('return_3m').notNull(),
    return5m: real('return_5m').notNull(),
    return15m: real('return_15m').notNull(),

    volumeImbalance: real('volume_imbalance').notNull(),
    volumeZscore: real('volume_zscore').notNull(),

    bookImbalanceL1: real('book_imbalance_l1').notNull(),
    bookImbalanceL5: real('book_imbalance_l5').notNull(),
    bookImbalanceL20: real('book_imbalance_l20').notNull(),
    spreadBps: real('spread_bps').notNull(),
    micropriceDeltaBps: real('microprice_delta_bps').notNull(),

    volatility1m: real('volatility_1m').notNull(),
    volatility5m: real('volatility_5m').notNull(),
    volatility15m: real('volatility_15m').notNull(),

    openInterestChange1m: real('open_interest_change_1m'),
    openInterestChange5m: real('open_interest_change_5m'),
    fundingRate: real('funding_rate'),

    candidateLong: integer('candidate_long', { mode: 'boolean' }).notNull(),
    candidateShort: integer('candidate_short', { mode: 'boolean' }).notNull(),
    featureVersion: text('feature_version').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('feature_snapshots_timestamp_idx').on(table.timestamp),
    index('feature_snapshots_symbol_timestamp_idx').on(table.symbol, table.timestamp),
    index('feature_snapshots_sample_type_timestamp_idx').on(table.sampleType, table.timestamp),
    index('feature_snapshots_candidate_long_timestamp_idx').on(table.candidateLong, table.timestamp),
    index('feature_snapshots_candidate_short_timestamp_idx').on(table.candidateShort, table.timestamp),
  ],
);

export const jevEvaluations = sqliteTable(
  'jev_evaluations',
  {
    id: text('id').primaryKey(),
    featureSnapshotId: text('feature_snapshot_id')
      .notNull()
      .references(() => featureSnapshots.id),
    experimentId: text('experiment_id').references(() => experiments.id),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    symbol: text('symbol').notNull(),
    horizonSeconds: integer('horizon_seconds').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    regime: text('regime', {
      enum: ['uptrend', 'downtrend', 'range', 'volatile', 'unclear'],
    }).notNull(),
    pLong: real('p_long').notNull(),
    pShort: real('p_short').notNull(),
    pFalseBreakout: real('p_false_breakout').notNull(),
    tradeQuality: real('trade_quality').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    estimatedCostUsd: real('estimated_cost_usd'),
    rawOutput: text('raw_output').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('jev_evaluations_snapshot_idx').on(table.featureSnapshotId),
    index('jev_evaluations_symbol_timestamp_idx').on(table.symbol, table.timestamp),
    index('jev_evaluations_model_prompt_idx').on(table.modelVersion, table.promptVersion),
  ],
);

export const outcomes = sqliteTable(
  'outcomes',
  {
    id: text('id').primaryKey(),
    featureSnapshotId: text('feature_snapshot_id')
      .notNull()
      .references(() => featureSnapshots.id),
    labeledAt: integer('labeled_at', { mode: 'timestamp_ms' }).notNull(),
    priceT0: real('price_t0').notNull(),
    price30s: real('price_30s'),
    price1m: real('price_1m'),
    price5m: real('price_5m'),
    price15m: real('price_15m'),
    return30s: real('return_30s'),
    return1m: real('return_1m'),
    return5m: real('return_5m'),
    return15m: real('return_15m'),
    mfe5m: real('mfe_5m'),
    mae5m: real('mae_5m'),
  },
  (table) => [
    uniqueIndex('outcomes_feature_snapshot_uidx').on(table.featureSnapshotId),
    index('outcomes_labeled_at_idx').on(table.labeledAt),
  ],
);

export const strategySignals = sqliteTable(
  'strategy_signals',
  {
    id: text('id').primaryKey(),
    featureSnapshotId: text('feature_snapshot_id')
      .notNull()
      .references(() => featureSnapshots.id),
    jevEvaluationId: text('jev_evaluation_id').references(() => jevEvaluations.id),
    experimentId: text('experiment_id').references(() => experiments.id),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    strategyVersion: text('strategy_version').notNull(),
    side: text('side', { enum: ['long', 'short', 'no_trade'] }).notNull(),
    confidence: real('confidence'),
    reasonCode: text('reason_code').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('strategy_signals_timestamp_idx').on(table.timestamp),
    index('strategy_signals_strategy_timestamp_idx').on(table.strategyVersion, table.timestamp),
  ],
);

export type Experiment = typeof experiments.$inferSelect;
export type NewExperiment = typeof experiments.$inferInsert;
export type FeatureSnapshot = typeof featureSnapshots.$inferSelect;
export type NewFeatureSnapshot = typeof featureSnapshots.$inferInsert;
export type JevEvaluation = typeof jevEvaluations.$inferSelect;
export type NewJevEvaluation = typeof jevEvaluations.$inferInsert;
export type Outcome = typeof outcomes.$inferSelect;
export type NewOutcome = typeof outcomes.$inferInsert;
export type StrategySignal = typeof strategySignals.$inferSelect;
export type NewStrategySignal = typeof strategySignals.$inferInsert;
