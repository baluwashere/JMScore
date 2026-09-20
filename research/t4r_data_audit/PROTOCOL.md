# T4R-1 — BTC historical data capability audit

## Objective

Determine which historical BTCUSDT USD-M perpetual datasets can support a defensible microstructure research design before any further model search.

## Probe date

Primary probe: 2023-09-15 UTC. This date is already inside the previously opened 2023 research universe; 2024/2025 remain unopened for model research.

## Sources

Primary source is Binance Data Vision public archives. The probe checks exact archive availability, verifies SHA256 checksums when published, inspects CSV schemas, timestamp cadence/order, and classifies what can and cannot be reconstructed.

Datasets probed:
- aggTrades
- bookTicker
- bookDepth
- metrics
- liquidationSnapshot
- markPriceKlines 1m
- indexPriceKlines 1m
- premiumIndexKlines 1m
- monthly fundingRate

The audit also records the separate authenticated Binance historical futures order-book route (`histDataLink`) as a candidate source requiring credentials/availability verification; it is not treated as available merely because documentation or legacy references exist.

## Classification

Each dataset is classified as one of:
- RELIABLE: schema and semantics support the stated feature family with integrity checks.
- PARTIAL: useful, but insufficient for full reconstruction or has material coverage/quality caveats.
- UNSUITABLE: unavailable or cannot support the intended feature family without fabrication.

## L2 gate

Historical L2 is considered reconstructible only if the data contain chronological price-level states or updates sufficient to recover at least top-5/top-20 bid/ask levels with timestamps and update ordering. Aggregated percentage-band depth is **not** L2 and cannot be used to infer adds, cancels, queue depletion, replenishment, or exact OFI.

## Fail-closed rules

- HTTP 404/403/451 => unavailable, not silently substituted.
- Checksum mismatch => UNSUITABLE.
- Unknown schema => PARTIAL/UNSUITABLE until manually resolved.
- Out-of-order event streams must be explicitly sorted by authoritative timestamp/update id before use.
- No interpolation or synthetic order-book levels.

## Decision outputs

The audit must answer:
1. Can we reconstruct historical true L2 from current public archives? yes/no.
2. Which features are safe now with public data?
3. Which desired features require authenticated Binance L2 or an external vendor?
4. What is the next highest-impact data acquisition step?
