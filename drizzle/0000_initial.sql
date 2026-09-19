PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  prompt_version TEXT,
  model_version TEXT,
  cost_model_version TEXT NOT NULL,
  configuration_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS experiments_status_created_at_idx ON experiments (status, created_at);

CREATE TABLE IF NOT EXISTS feature_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT REFERENCES experiments(id),
  timestamp INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  sample_type TEXT NOT NULL,
  price REAL NOT NULL,
  return_15s REAL NOT NULL,
  return_30s REAL NOT NULL,
  return_1m REAL NOT NULL,
  return_3m REAL NOT NULL,
  return_5m REAL NOT NULL,
  return_15m REAL NOT NULL,
  volume_imbalance REAL NOT NULL,
  volume_zscore REAL NOT NULL,
  book_imbalance_l1 REAL NOT NULL,
  book_imbalance_l5 REAL NOT NULL,
  book_imbalance_l20 REAL NOT NULL,
  spread_bps REAL NOT NULL,
  microprice_delta_bps REAL NOT NULL,
  volatility_1m REAL NOT NULL,
  volatility_5m REAL NOT NULL,
  volatility_15m REAL NOT NULL,
  open_interest_change_1m REAL,
  open_interest_change_5m REAL,
  funding_rate REAL,
  candidate_long INTEGER NOT NULL,
  candidate_short INTEGER NOT NULL,
  feature_version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feature_snapshots_timestamp_idx ON feature_snapshots (timestamp);
CREATE INDEX IF NOT EXISTS feature_snapshots_symbol_timestamp_idx ON feature_snapshots (symbol, timestamp);
CREATE INDEX IF NOT EXISTS feature_snapshots_sample_type_timestamp_idx ON feature_snapshots (sample_type, timestamp);
CREATE INDEX IF NOT EXISTS feature_snapshots_candidate_long_timestamp_idx ON feature_snapshots (candidate_long, timestamp);
CREATE INDEX IF NOT EXISTS feature_snapshots_candidate_short_timestamp_idx ON feature_snapshots (candidate_short, timestamp);

CREATE TABLE IF NOT EXISTS jev_evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  feature_snapshot_id TEXT NOT NULL REFERENCES feature_snapshots(id),
  experiment_id TEXT REFERENCES experiments(id),
  timestamp INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  horizon_seconds INTEGER NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  regime TEXT NOT NULL,
  p_long REAL NOT NULL,
  p_short REAL NOT NULL,
  p_false_breakout REAL NOT NULL,
  trade_quality REAL NOT NULL,
  latency_ms INTEGER NOT NULL,
  estimated_cost_usd REAL,
  raw_output TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jev_evaluations_snapshot_idx ON jev_evaluations (feature_snapshot_id);
CREATE INDEX IF NOT EXISTS jev_evaluations_symbol_timestamp_idx ON jev_evaluations (symbol, timestamp);
CREATE INDEX IF NOT EXISTS jev_evaluations_model_prompt_idx ON jev_evaluations (model_version, prompt_version);

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY NOT NULL,
  feature_snapshot_id TEXT NOT NULL REFERENCES feature_snapshots(id),
  labeled_at INTEGER NOT NULL,
  price_t0 REAL NOT NULL,
  price_30s REAL,
  price_1m REAL,
  price_5m REAL,
  price_15m REAL,
  return_30s REAL,
  return_1m REAL,
  return_5m REAL,
  return_15m REAL,
  mfe_5m REAL,
  mae_5m REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS outcomes_feature_snapshot_uidx ON outcomes (feature_snapshot_id);
CREATE INDEX IF NOT EXISTS outcomes_labeled_at_idx ON outcomes (labeled_at);

CREATE TABLE IF NOT EXISTS strategy_signals (
  id TEXT PRIMARY KEY NOT NULL,
  feature_snapshot_id TEXT NOT NULL REFERENCES feature_snapshots(id),
  jev_evaluation_id TEXT REFERENCES jev_evaluations(id),
  experiment_id TEXT REFERENCES experiments(id),
  timestamp INTEGER NOT NULL,
  strategy_version TEXT NOT NULL,
  side TEXT NOT NULL,
  confidence REAL,
  reason_code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS strategy_signals_timestamp_idx ON strategy_signals (timestamp);
CREATE INDEX IF NOT EXISTS strategy_signals_strategy_timestamp_idx ON strategy_signals (strategy_version, timestamp);
