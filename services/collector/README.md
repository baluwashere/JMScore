# JMScore BTC market collector

T2 implements the first exchange adapter for the JMScore research pipeline.

## Provider

Binance USDⓈ-M Futures, `BTCUSDT` by default.

The collector uses Binance's 2026 routed WebSocket architecture:

- public high-frequency stream: `wss://fstream.binance.com/public`
- regular market stream: `wss://fstream.binance.com/market`
- open interest REST: `https://fapi.binance.com/fapi/v1/openInterest`

No API key or trading credentials are used.

## Feeds

Public WebSocket:

- `btcusdt@depth20@100ms`
- `btcusdt@bookTicker`

Market WebSocket:

- `btcusdt@aggTrade`
- `btcusdt@markPrice@1s`

REST poll, every 10 seconds by default:

- current BTCUSDT open interest

All exchange payloads are validated and normalized into internal JMScore event types before downstream use.

Open interest is useful but non-core for T2. If the REST endpoint is unavailable from a deployment region, the collector reports it as stale/degraded while continuing to serve the WebSocket market state.

## Run

From the repository root:

```bash
npm install
npm --workspace @jmscore/collector run start
```

Optional symbol override:

```bash
COLLECTOR_SYMBOL=ETHUSDT npm --workspace @jmscore/collector run start
```

## Smoke test

The live smoke test requires the four core WebSocket feeds to arrive within 30 seconds:

- aggregate trades
- depth
- best bid/ask
- mark price/funding

Open interest is reported separately as an optional feed.

```bash
npm --workspace @jmscore/collector run smoke
```

Expected success shape:

```json
{"ok":true,"received":"all_required_websocket_feeds","optional":{"openInterestReceived":false}}
```

The optional value may be `true` on hosts where the Binance open-interest REST endpoint is accessible.

## Reliability behavior

- exponential reconnect with jitter, capped at 30 seconds
- silence watchdog terminates stale sockets and forces reconnect
- malformed exchange payloads are rejected rather than propagated
- data freshness is tracked independently for every feed
- `st != 1` events are ignored when Binance supplies the merged UM/CM symbol-type field
- open-interest requests have an 8 second timeout and cannot overlap
- open-interest failure does not invalidate otherwise healthy core WebSocket state
- graceful `SIGINT` / `SIGTERM` shutdown

## Persistence

T2 deliberately performs no database writes. Raw market events remain ephemeral. T3 will build bounded rolling state; T5 will decide which analytically useful snapshots are persisted to Turso.
