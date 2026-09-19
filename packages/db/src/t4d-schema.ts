import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const rareMoveCandidates = sqliteTable(
  'rare_move_candidates',
  {
    id: text('id').primaryKey(),
    experimentId: text('experiment_id'),
    featureSnapshotId: text('feature_snapshot_id'),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    symbol: text('symbol').notNull(),
    horizonSeconds: integer('horizon_seconds').notNull(),
    side: text('side', { enum: ['long', 'short'] }).notNull(),
    modelFamily: text('model_family').notNull(),
    modelVersion: text('model_version').notNull(),
    calibrationVersion: text('calibration_version').notNull(),
    featureVersion: text('feature_version').notNull(),
    costModelVersion: text('cost_model_version').notNull(),
    barrierNetBps: real('barrier_net_bps').notNull(),
    probability: real('probability').notNull(),
    threshold: real('threshold').notNull(),
    estimatedRoundtripFeeBps: real('estimated_roundtrip_fee_bps').notNull(),
    stateJson: text('state_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('rare_move_candidates_timestamp_idx').on(table.timestamp),
    index('rare_move_candidates_symbol_timestamp_idx').on(table.symbol, table.timestamp),
    index('rare_move_candidates_model_timestamp_idx').on(table.modelVersion, table.timestamp),
    uniqueIndex('rare_move_candidates_identity_uidx').on(
      table.symbol,
      table.timestamp,
      table.modelVersion,
      table.barrierNetBps,
      table.side,
    ),
  ],
);

export const jevShadowEvaluations = sqliteTable(
  'jev_shadow_evaluations',
  {
    id: text('id').primaryKey(),
    candidateId: text('candidate_id')
      .notNull()
      .references(() => rareMoveCandidates.id),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    status: text('status', { enum: ['ok', 'unavailable'] }).notNull(),
    regime: text('regime', {
      enum: ['CONTINUATION', 'REVERSAL', 'EXHAUSTION', 'CHOP', 'UNCLEAR'],
    }),
    regimeProbabilitiesJson: text('regime_probabilities_json'),
    continuationProbability: real('continuation_probability'),
    falseBreakoutProbability: real('false_breakout_probability'),
    setupQuality: real('setup_quality'),
    setupQualityProbabilitiesJson: text('setup_quality_probabilities_json'),
    latencyMs: integer('latency_ms').notNull(),
    rawOutput: text('raw_output'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('jev_shadow_evaluations_candidate_uidx').on(table.candidateId),
    index('jev_shadow_evaluations_timestamp_idx').on(table.timestamp),
    index('jev_shadow_evaluations_status_timestamp_idx').on(table.status, table.timestamp),
  ],
);

export type RareMoveCandidate = typeof rareMoveCandidates.$inferSelect;
export type NewRareMoveCandidate = typeof rareMoveCandidates.$inferInsert;
export type JevShadowEvaluation = typeof jevShadowEvaluations.$inferSelect;
export type NewJevShadowEvaluation = typeof jevShadowEvaluations.$inferInsert;
