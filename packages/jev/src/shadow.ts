import { experimental_evaluate as evaluate } from 'ai';
import { z } from 'zod';

export const JEV_MODEL = 'typesafe-ai/jev' as const;
export const JEV_PROMPT_VERSION = 'jev-shadow-v001' as const;

export const jevCandidateStateSchema = z.object({
  symbol: z.literal('BTCUSDT'),
  timestampMs: z.number().int().nonnegative(),
  horizonSeconds: z.literal(300),
  side: z.enum(['long', 'short']),
  quant: z.object({
    modelFamily: z.string().min(1),
    barrierNetBps: z.number().finite().nonnegative(),
    probability: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
    estimatedRoundtripFeeBps: z.number().finite().nonnegative(),
  }),
  price: z.object({
    return5s: z.number().finite(),
    return15s: z.number().finite(),
    return30s: z.number().finite(),
    return60s: z.number().finite(),
    return300s: z.number().finite(),
    realizedVol30s: z.number().finite().nonnegative(),
    realizedVol60s: z.number().finite().nonnegative(),
    realizedVol300s: z.number().finite().nonnegative(),
  }),
  flow: z.object({
    volumeImbalance5s: z.number().min(-1).max(1),
    volumeImbalance15s: z.number().min(-1).max(1),
    volumeImbalance30s: z.number().min(-1).max(1),
    volumeImbalance60s: z.number().min(-1).max(1),
    countImbalance5s: z.number().min(-1).max(1),
    countImbalance15s: z.number().min(-1).max(1),
    countImbalance30s: z.number().min(-1).max(1),
    countImbalance60s: z.number().min(-1).max(1),
    flowAccel5v30: z.number().finite(),
    flowAccel15v60: z.number().finite(),
    volumeZ30sVs20: z.number().finite(),
  }),
  book: z.object({
    spreadBps: z.number().finite().nonnegative(),
    imbalanceL1: z.number().min(-1).max(1),
    micropriceDeltaBps: z.number().finite(),
    quoteUpdates30s: z.number().finite().nonnegative(),
  }),
});

export type JevCandidateState = z.infer<typeof jevCandidateStateSchema>;

const regimeSchema = z.enum(['CONTINUATION', 'REVERSAL', 'EXHAUSTION', 'CHOP', 'UNCLEAR']);

const jevAnswerSchema = z.object({
  regime: z.object({
    type: z.literal('choice'),
    choice: regimeSchema,
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),
  continuation: z.object({
    type: z.literal('boolean'),
    probability: z.number().min(0).max(1),
  }),
  falseBreakout: z.object({
    type: z.literal('boolean'),
    probability: z.number().min(0).max(1),
  }),
  setupQuality: z.object({
    type: z.literal('score'),
    score: z.number().min(0).max(4),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),
});

export type JevAnswers = z.infer<typeof jevAnswerSchema>;

export type JevShadowResult =
  | {
      status: 'ok';
      model: typeof JEV_MODEL;
      promptVersion: typeof JEV_PROMPT_VERSION;
      latencyMs: number;
      answers: JevAnswers;
      rawOutput: string;
    }
  | {
      status: 'unavailable';
      model: typeof JEV_MODEL;
      promptVersion: typeof JEV_PROMPT_VERSION;
      latencyMs: number;
      error: string;
    };

export function normalizeJevAnswers(value: unknown): JevAnswers {
  return jevAnswerSchema.parse(value);
}

export async function evaluateJevShadow(input: JevCandidateState): Promise<JevShadowResult> {
  const state = jevCandidateStateSchema.parse(input);
  const startedAt = Date.now();

  try {
    const result = await evaluate({
      model: JEV_MODEL,
      state,
      questions: {
        regime: {
          type: 'choice',
          instructions: 'Classify the five-minute market setup from the supplied state. Do not infer information that is not present.',
          criteria: {
            CONTINUATION: 'current directional move is coherently supported and more likely to continue than reverse',
            REVERSAL: 'state is more consistent with a directional reversal than continuation',
            EXHAUSTION: 'directional move appears stretched or weakening without enough evidence for a clean reversal',
            CHOP: 'state is range-like, conflicting, or dominated by two-sided noise',
            UNCLEAR: 'available evidence is insufficient or materially contradictory',
          },
        },
        continuation: {
          type: 'boolean',
          instructions: 'Does the supplied market state support continuation in the quantitative candidate side over approximately five minutes?',
          criteria: {
            true: 'price, order flow, and top-of-book evidence are coherently aligned with the candidate side',
            false: 'evidence is neutral, contradictory, exhausted, or aligned against the candidate side',
          },
        },
        falseBreakout: {
          type: 'boolean',
          instructions: 'Is the supplied state more consistent with a false breakout or exhausted move than durable continuation?',
          criteria: {
            true: 'price extension lacks confirming flow/book support or shows meaningful exhaustion/reversal evidence',
            false: 'no material false-breakout or exhaustion evidence is present',
          },
        },
        setupQuality: {
          type: 'score',
          instructions: 'Rate the coherence of this directional setup using only the supplied state.',
          criteria: [
            '0: incoherent or clearly adverse',
            '1: weak and mostly conflicting',
            '2: mixed or ambiguous',
            '3: coherent directional alignment',
            '4: unusually strong multi-signal alignment',
          ],
        },
      },
    });

    const answers = normalizeJevAnswers(result.answers);
    return {
      status: 'ok',
      model: JEV_MODEL,
      promptVersion: JEV_PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      answers,
      rawOutput: JSON.stringify(result.answers),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      model: JEV_MODEL,
      promptVersion: JEV_PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
