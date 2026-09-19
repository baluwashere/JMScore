import assert from 'node:assert/strict';
import test from 'node:test';

import { jevCandidateStateSchema, normalizeJevAnswers } from './shadow.js';

const candidate = {
  symbol: 'BTCUSDT',
  timestampMs: 1_694_000_000_000,
  horizonSeconds: 300,
  side: 'long',
  quant: {
    modelFamily: 'logistic_regression',
    barrierNetBps: 8,
    probability: 0.72,
    threshold: 0.65,
    estimatedRoundtripFeeBps: 8,
  },
  price: {
    return5s: 0.001,
    return15s: 0.002,
    return30s: 0.003,
    return60s: 0.004,
    return300s: 0.008,
    realizedVol30s: 0.002,
    realizedVol60s: 0.003,
    realizedVol300s: 0.006,
  },
  flow: {
    volumeImbalance5s: 0.6,
    volumeImbalance15s: 0.5,
    volumeImbalance30s: 0.4,
    volumeImbalance60s: 0.3,
    countImbalance5s: 0.5,
    countImbalance15s: 0.4,
    countImbalance30s: 0.3,
    countImbalance60s: 0.2,
    flowAccel5v30: 0.2,
    flowAccel15v60: 0.2,
    volumeZ30sVs20: 2.1,
  },
  book: {
    spreadBps: 1.2,
    imbalanceL1: 0.55,
    micropriceDeltaBps: 1.8,
    quoteUpdates30s: 1200,
  },
} as const;

test('validates a BTC rare-move candidate state', () => {
  assert.equal(jevCandidateStateSchema.parse(candidate).symbol, 'BTCUSDT');
});

test('rejects invalid probabilities rather than clipping them', () => {
  assert.throws(() => jevCandidateStateSchema.parse({
    ...candidate,
    quant: { ...candidate.quant, probability: 1.1 },
  }));
});

test('normalizes the typed Jev answer contract', () => {
  const answers = normalizeJevAnswers({
    regime: {
      type: 'choice',
      choice: 'CONTINUATION',
      probabilities: { CONTINUATION: 0.7, REVERSAL: 0.1, EXHAUSTION: 0.1, CHOP: 0.05, UNCLEAR: 0.05 },
    },
    continuation: { type: 'boolean', probability: 0.78 },
    falseBreakout: { type: 'boolean', probability: 0.13 },
    setupQuality: { type: 'score', score: 3.2, probabilities: { '0': 0.01, '1': 0.04, '2': 0.15, '3': 0.55, '4': 0.25 } },
  });

  assert.equal(answers.regime.choice, 'CONTINUATION');
  assert.equal(answers.continuation.probability, 0.78);
  assert.equal(answers.falseBreakout.probability, 0.13);
  assert.equal(answers.setupQuality.score, 3.2);
});
