import { z } from 'zod';

const numericString = z.string().refine((value) => Number.isFinite(Number(value)), 'not numeric');
const level = z.tuple([numericString, numericString]);

export const combinedEnvelopeSchema = z.object({
  stream: z.string(),
  data: z.unknown(),
});

export const aggTradeSchema = z
  .object({
    e: z.literal('aggTrade'),
    E: z.number(),
    s: z.string(),
    a: z.number(),
    p: numericString,
    q: numericString,
    T: z.number(),
    m: z.boolean(),
    st: z.number().optional(),
  })
  .passthrough();

export const partialDepthSchema = z
  .object({
    e: z.literal('depthUpdate'),
    E: z.number(),
    T: z.number(),
    s: z.string(),
    U: z.number(),
    u: z.number(),
    pu: z.number(),
    b: z.array(level),
    a: z.array(level),
    st: z.number().optional(),
  })
  .passthrough();

export const bookTickerSchema = z
  .object({
    e: z.literal('bookTicker'),
    E: z.number(),
    T: z.number(),
    s: z.string(),
    u: z.number(),
    b: numericString,
    B: numericString,
    a: numericString,
    A: numericString,
    st: z.number().optional(),
  })
  .passthrough();

export const markPriceSchema = z
  .object({
    e: z.literal('markPriceUpdate'),
    E: z.number(),
    s: z.string(),
    p: numericString,
    i: numericString,
    P: numericString.optional(),
    r: numericString,
    T: z.number(),
    ap: numericString.optional(),
    st: z.number().optional(),
  })
  .passthrough();

export const openInterestSchema = z
  .object({
    symbol: z.string(),
    openInterest: numericString,
    time: z.number(),
  })
  .passthrough();
