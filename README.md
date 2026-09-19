# JMScore

Jev Momentum Lab — research system to test whether Jev adds economically useful predictive value to short-horizon crypto momentum signals.

## Current scope

The first deliverable is **Jev Momentum Recorder v0.1**, not a live-money trading bot.

It will:

1. ingest BTC market data;
2. maintain rolling market state in memory;
3. calculate deterministic momentum/microstructure features;
4. persist candidate/control snapshots to Turso;
5. evaluate candidate states with Jev via Vercel AI Gateway;
6. label future 30s/1m/5m/15m outcomes;
7. compare Jev-filtered momentum with non-AI baselines.

## Hard rule

AI may influence trade selection. AI never controls portfolio risk.

## Stack

- TypeScript (strict)
- Turso/libSQL
- Drizzle ORM
- Vercel AI Gateway
- Jev (`typesafe-ai/jev`)
- Next.js/Vercel dashboard later in the MVP

See [`docs/PRD.md`](docs/PRD.md) for the product specification.
