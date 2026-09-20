# T4R-1 — BTC historical data capability audit

Probe date: **2023-09-15**

L2 gate: **PUBLIC_L2_NOT_RECONSTRUCTIBLE**

| Dataset | HTTP | Classification | Key use / limitation |
|---|---:|---|---|
| aggTrades | 200 | RELIABLE | trade price/qty; aggressor side; trade-flow imbalance; volume shocks |
| bookTicker | 200 | RELIABLE | BBO; spread; L1 imbalance; microprice; sort by event_time/update_id if source order is non-monotonic |
| bookDepth | 200 | PARTIAL | coarse depth/liquidity regime by percentage band; cannot reconstruct price-level L2, adds/cancels, queue depletion, replenishment or exact OFI |
| metrics | 200 | PARTIAL | open-interest and positioning regime at coarse cadence |
| liquidationSnapshot | 404 | UNSUITABLE | public archive unavailable for probe date |
| markPriceKlines 1m | 200 | PARTIAL | mark-price regime; bar data only |
| indexPriceKlines 1m | 200 | PARTIAL | index-price regime; bar data only |
| premiumIndexKlines 1m | 200 | PARTIAL | premium regime; bar data only |
| fundingRate monthly | 200 | PARTIAL | funding context; slow-moving |

## Empirical probe details

### aggTrades
- SHA256 checksum matched.
- Archive size: 9,770,253 bytes.
- Schema: `agg_trade_id, price, quantity, first_trade_id, last_trade_id, transact_time, is_buyer_maker`.
- First 200,000 records had zero backwards timestamps.
- Median positive timestamp increment in the sample: ~0.167 s.

### bookTicker
- SHA256 checksum matched.
- Archive size: 140,418,746 bytes.
- Schema: `update_id, best_bid_price, best_bid_qty, best_ask_price, best_ask_qty, transaction_time, event_time`.
- First 200,000 records had zero backwards event/transaction timestamps and zero backwards update IDs on this probe date.
- Median positive event-time increment in the sample: ~0.005 s.
- Historical BTC/ETH archive ordering problems have been reported elsewhere, so consumers must retain explicit sorting/monotonicity validation rather than assuming file order.

### bookDepth
- SHA256 checksum matched.
- Archive size: 476,014 bytes.
- Schema: `timestamp, percentage, depth, notional`.
- Exactly 28,800 rows = 2,880 snapshots × 10 percentage bands.
- Bands: `-5,-4,-3,-2,-1,+1,+2,+3,+4,+5` percent.
- Example first snapshot timestamp: `2023-09-15 00:00:13`; subsequent snapshots are irregular around a ~30 s cadence.
- No exact price levels, update IDs, order IDs or level-change events are present.

**Conclusion:** public `bookDepth` is an aggregated liquidity-band product, not a replayable L2 order book.

### metrics
- SHA256 checksum matched.
- 288 rows/day = 5-minute cadence.
- Fields include open interest value plus top-trader/global long-short and taker-volume ratios.

### mark/index/premium
- All three 1-minute archives were present and checksum-valid.
- 1,440 rows/day each.
- Useful as contextual state, not execution microstructure.

### funding
- Monthly archive present and checksum-valid.
- 8-hour median cadence for September 2023.

## L2 decision

The current public archive cannot support:
- exact L5/L20 book imbalance;
- adds/cancels;
- queue depletion;
- replenishment;
- exact depth slope by price level;
- order-flow imbalance from book updates;
- absorption against opposing exact depth.

It can safely support now:
- event-level aggressor trade-flow features from aggTrades;
- BBO/spread/L1 imbalance/microprice from bookTicker;
- coarse percentage-band liquidity regimes from bookDepth;
- 5-minute OI/positioning context from metrics;
- mark/index/premium/funding context.

## Authenticated L2 candidate

Binance documentation/legacy interfaces expose `GET /sapi/v1/futures/histDataLink` with historical order-book data types such as `T_DEPTH` and `S_DEPTH`. This is **not treated as available** until authenticated access and 2023 BTCUSDT coverage are directly verified.

## Immediate research consequence

Do not implement exact-L2/queue/absorption features using public `bookDepth` proxies. The next acquisition decision is binary:

1. verify authenticated Binance `histDataLink` access for BTCUSDT 2023; or
2. source a third-party true L2 historical dataset.

Until then, any new public-data research must remain explicitly within the validated `aggTrades + BBO + coarse liquidity/context` capability set.
