CREATE TABLE `rare_move_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `experiment_id` text,
  `feature_snapshot_id` text,
  `timestamp` integer NOT NULL,
  `symbol` text NOT NULL,
  `horizon_seconds` integer NOT NULL,
  `side` text NOT NULL,
  `model_family` text NOT NULL,
  `model_version` text NOT NULL,
  `calibration_version` text NOT NULL,
  `feature_version` text NOT NULL,
  `cost_model_version` text NOT NULL,
  `barrier_net_bps` real NOT NULL,
  `probability` real NOT NULL,
  `threshold` real NOT NULL,
  `estimated_roundtrip_fee_bps` real NOT NULL,
  `state_json` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rare_move_candidates_timestamp_idx` ON `rare_move_candidates` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `rare_move_candidates_symbol_timestamp_idx` ON `rare_move_candidates` (`symbol`,`timestamp`);
--> statement-breakpoint
CREATE INDEX `rare_move_candidates_model_timestamp_idx` ON `rare_move_candidates` (`model_version`,`timestamp`);
--> statement-breakpoint
CREATE UNIQUE INDEX `rare_move_candidates_identity_uidx` ON `rare_move_candidates` (`symbol`,`timestamp`,`model_version`,`barrier_net_bps`,`side`);
--> statement-breakpoint
CREATE TABLE `jev_shadow_evaluations` (
  `id` text PRIMARY KEY NOT NULL,
  `candidate_id` text NOT NULL,
  `timestamp` integer NOT NULL,
  `model` text NOT NULL,
  `prompt_version` text NOT NULL,
  `status` text NOT NULL,
  `regime` text,
  `regime_probabilities_json` text,
  `continuation_probability` real,
  `false_breakout_probability` real,
  `setup_quality` real,
  `setup_quality_probabilities_json` text,
  `latency_ms` integer NOT NULL,
  `raw_output` text,
  `error` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`candidate_id`) REFERENCES `rare_move_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jev_shadow_evaluations_candidate_uidx` ON `jev_shadow_evaluations` (`candidate_id`);
--> statement-breakpoint
CREATE INDEX `jev_shadow_evaluations_timestamp_idx` ON `jev_shadow_evaluations` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `jev_shadow_evaluations_status_timestamp_idx` ON `jev_shadow_evaluations` (`status`,`timestamp`);
