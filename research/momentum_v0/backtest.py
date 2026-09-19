#!/usr/bin/env python3
"""JMScore baseline momentum v0 historical gate.

Uses official Binance Vision BTCUSDT USD-M 1-minute klines. The baseline is
frozen before observing results:

LONG  = return_1m > 0 AND return_5m > 0 AND volume_imbalance_1m > 0
SHORT = return_1m < 0 AND return_5m < 0 AND volume_imbalance_1m < 0

Signal uses the completed minute t. Entry is the next minute open, preventing
same-bar execution/look-ahead. Primary horizon is 5 minutes.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import statistics
import sys
import time
import urllib.error
import urllib.request
import zipfile
from array import array
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

SYMBOL = "BTCUSDT"
START_YEAR = 2023
END_YEAR = 2025
BASE_URL = "https://data.binance.vision/data/futures/um/monthly/klines"
ROUNDTRIP_COST_BPS = (8.0, 10.0, 14.0)
HORIZONS_MINUTES = (1, 5, 15)
USER_AGENT = "JMScore-research/0.1"


@dataclass
class Series:
    ts: array
    open: array
    high: array
    low: array
    close: array
    volume: array
    taker_buy: array

    @classmethod
    def empty(cls) -> "Series":
        return cls(array("q"), array("d"), array("d"), array("d"), array("d"), array("d"), array("d"))

    def __len__(self) -> int:
        return len(self.ts)


@dataclass
class Metric:
    n: int
    long_n: int
    short_n: int
    mean_gross_bps: float | None
    median_gross_bps: float | None
    gross_win_rate: float | None
    mean_net_8bps: float | None
    mean_net_10bps: float | None
    mean_net_14bps: float | None
    net10_win_rate: float | None
    gross_profit_factor: float | None
    net10_profit_factor: float | None
    naive_t_stat: float | None
    break_even_roundtrip_bps: float | None


@dataclass
class Trade:
    signal_index: int
    year: int
    side: int
    entry: float
    gross: dict[int, float]
    mfe_5m: float
    mae_5m: float


def request_bytes(url: str, attempts: int = 4) -> bytes:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=90) as response:
                return response.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            time.sleep(2 ** attempt)
    raise RuntimeError(f"download failed after {attempts} attempts: {url}: {last_error}")


def archive_url(year: int, month: int) -> str:
    name = f"{SYMBOL}-1m-{year:04d}-{month:02d}.zip"
    return f"{BASE_URL}/{SYMBOL}/1m/{name}"


def verify_checksum(zip_bytes: bytes, url: str) -> None:
    checksum_text = request_bytes(url + ".CHECKSUM").decode("utf-8", errors="replace").strip()
    expected = checksum_text.split()[0].lower()
    actual = hashlib.sha256(zip_bytes).hexdigest().lower()
    if expected != actual:
        raise RuntimeError(f"checksum mismatch for {url}: {actual} != {expected}")


def normalize_timestamp(value: str) -> int:
    ts = int(value)
    # Binance documents microsecond timestamps for some archives. Normalize to ms
    # defensively so the research clock is stable across archive format changes.
    if ts > 100_000_000_000_000:
        ts //= 1_000
    return ts


def parse_month(zip_bytes: bytes, series: Series) -> int:
    count = 0
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [name for name in zf.namelist() if name.lower().endswith(".csv")]
        if len(names) != 1:
            raise RuntimeError(f"expected one CSV in archive, found {names}")
        with zf.open(names[0], "r") as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            reader = csv.reader(text)
            for row in reader:
                if not row:
                    continue
                try:
                    ts = normalize_timestamp(row[0])
                except (ValueError, IndexError):
                    # Header row when present.
                    continue
                if len(row) < 11:
                    raise RuntimeError(f"unexpected kline row with {len(row)} columns")
                series.ts.append(ts)
                series.open.append(float(row[1]))
                series.high.append(float(row[2]))
                series.low.append(float(row[3]))
                series.close.append(float(row[4]))
                series.volume.append(float(row[5]))
                series.taker_buy.append(float(row[9]))
                count += 1
    return count


def load_series() -> Series:
    series = Series.empty()
    for year in range(START_YEAR, END_YEAR + 1):
        for month in range(1, 13):
            url = archive_url(year, month)
            print(json.dumps({"event": "download", "year": year, "month": month, "url": url}), flush=True)
            blob = request_bytes(url)
            verify_checksum(blob, url)
            rows = parse_month(blob, series)
            print(json.dumps({"event": "loaded", "year": year, "month": month, "rows": rows}), flush=True)
    return series


def year_from_ms(ts: int) -> int:
    # Calendar year in UTC without datetime object allocation per row.
    import datetime as _dt
    return _dt.datetime.fromtimestamp(ts / 1000, tz=_dt.timezone.utc).year


def qa(series: Series) -> dict[str, int]:
    gaps = 0
    duplicates = 0
    backwards = 0
    irregular = 0
    for i in range(1, len(series)):
        delta = series.ts[i] - series.ts[i - 1]
        if delta == 0:
            duplicates += 1
        elif delta < 0:
            backwards += 1
        elif delta > 60_000:
            gaps += 1
        elif delta != 60_000:
            irregular += 1
    return {
        "rows": len(series),
        "gaps_gt_1m": gaps,
        "duplicates": duplicates,
        "backwards": backwards,
        "irregular_subminute_deltas": irregular,
    }


def build_trades(series: Series) -> list[Trade]:
    trades: list[Trade] = []
    n = len(series)
    max_h = max(HORIZONS_MINUTES)

    for i in range(5, n - max_h - 1):
        # Require exact one-minute continuity over the signal history and all
        # forward horizons. Do not bridge exchange/data gaps.
        if series.ts[i] - series.ts[i - 5] != 5 * 60_000:
            continue
        if series.ts[i + max_h + 1] - series.ts[i] != (max_h + 1) * 60_000:
            continue

        close_now = series.close[i]
        ret_1m = close_now / series.close[i - 1] - 1.0
        ret_5m = close_now / series.close[i - 5] - 1.0
        volume = series.volume[i]
        if volume <= 0:
            continue
        imbalance = (2.0 * series.taker_buy[i] - volume) / volume

        side = 0
        if ret_1m > 0.0 and ret_5m > 0.0 and imbalance > 0.0:
            side = 1
        elif ret_1m < 0.0 and ret_5m < 0.0 and imbalance < 0.0:
            side = -1
        else:
            continue

        entry_index = i + 1
        entry = series.open[entry_index]
        if entry <= 0:
            continue

        gross: dict[int, float] = {}
        for horizon in HORIZONS_MINUTES:
            exit_price = series.open[entry_index + horizon]
            gross[horizon] = side * (exit_price / entry - 1.0)

        future_highs = series.high[entry_index: entry_index + 5]
        future_lows = series.low[entry_index: entry_index + 5]
        if side == 1:
            mfe = max(future_highs) / entry - 1.0
            mae = min(future_lows) / entry - 1.0
        else:
            mfe = 1.0 - min(future_lows) / entry
            mae = 1.0 - max(future_highs) / entry

        trades.append(
            Trade(
                signal_index=i,
                year=year_from_ms(series.ts[i]),
                side=side,
                entry=entry,
                gross=gross,
                mfe_5m=mfe,
                mae_5m=mae,
            )
        )
    return trades


def profit_factor(values: list[float]) -> float | None:
    gains = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    if losses == 0:
        return None if gains == 0 else math.inf
    return gains / losses


def metric(trades: Iterable[Trade], horizon: int) -> Metric:
    subset = list(trades)
    values = [t.gross[horizon] for t in subset]
    if not values:
        return Metric(0, 0, 0, None, None, None, None, None, None, None, None, None, None, None)

    mean = statistics.fmean(values)
    median = statistics.median(values)
    stdev = statistics.stdev(values) if len(values) > 1 else 0.0
    se = stdev / math.sqrt(len(values)) if stdev > 0 else 0.0
    t_stat = mean / se if se > 0 else None

    net_8 = [v - 0.0008 for v in values]
    net_10 = [v - 0.0010 for v in values]
    net_14 = [v - 0.0014 for v in values]

    return Metric(
        n=len(subset),
        long_n=sum(1 for t in subset if t.side == 1),
        short_n=sum(1 for t in subset if t.side == -1),
        mean_gross_bps=mean * 10_000,
        median_gross_bps=median * 10_000,
        gross_win_rate=sum(1 for v in values if v > 0) / len(values),
        mean_net_8bps=statistics.fmean(net_8) * 10_000,
        mean_net_10bps=statistics.fmean(net_10) * 10_000,
        mean_net_14bps=statistics.fmean(net_14) * 10_000,
        net10_win_rate=sum(1 for v in net_10 if v > 0) / len(net_10),
        gross_profit_factor=profit_factor(values),
        net10_profit_factor=profit_factor(net_10),
        naive_t_stat=t_stat,
        break_even_roundtrip_bps=mean * 10_000,
    )


def non_overlapping_5m(trades: list[Trade]) -> list[Trade]:
    selected: list[Trade] = []
    next_eligible_signal_index = -1
    for trade in trades:
        if trade.signal_index < next_eligible_signal_index:
            continue
        selected.append(trade)
        # Signal at i, entry i+1, exit i+6. Next signal is allowed only once
        # that position has exited.
        next_eligible_signal_index = trade.signal_index + 6
    return selected


def directional_metric(trades: list[Trade], year: int, horizon: int, side: int | None = None) -> Metric:
    subset = [t for t in trades if t.year == year and (side is None or t.side == side)]
    return metric(subset, horizon)


def render_markdown(result: dict) -> str:
    lines = [
        "# Momentum v0 historical gate",
        "",
        f"Dataset: Binance Vision USD-M `{SYMBOL}` 1m klines, {START_YEAR}–{END_YEAR}.",
        "",
        "Frozen signal: LONG when return_1m > 0, return_5m > 0 and taker-volume imbalance > 0; SHORT for all three < 0.",
        "Signal is formed after minute t closes; entry is minute t+1 open. No parameter tuning was performed.",
        "",
        "## Data QA",
        "",
        "```json",
        json.dumps(result["qa"], indent=2),
        "```",
        "",
        "## Five-minute primary horizon",
        "",
        "| Year | N | Gross mean bps | Gross win % | Net mean @8bp | Net mean @10bp | Net mean @14bp | Net10 PF |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for year in range(START_YEAR, END_YEAR + 1):
        m = result["years"][str(year)]["5m"]
        lines.append(
            f"| {year} | {m['n']} | {fmt(m['mean_gross_bps'])} | {fmt_pct(m['gross_win_rate'])} | "
            f"{fmt(m['mean_net_8bps'])} | {fmt(m['mean_net_10bps'])} | {fmt(m['mean_net_14bps'])} | {fmt(m['net10_profit_factor'])} |"
        )
    pooled = result["pooled"]["5m"]
    lines.append(
        f"| **Pooled** | **{pooled['n']}** | **{fmt(pooled['mean_gross_bps'])}** | **{fmt_pct(pooled['gross_win_rate'])}** | "
        f"**{fmt(pooled['mean_net_8bps'])}** | **{fmt(pooled['mean_net_10bps'])}** | **{fmt(pooled['mean_net_14bps'])}** | **{fmt(pooled['net10_profit_factor'])}** |"
    )

    lines += [
        "",
        "## Non-overlapping 5-minute positions",
        "",
        "This removes overlapping signals by permitting only one 5-minute position at a time.",
        "",
        "| Year | N | Gross mean bps | Net mean @10bp | Net10 win % | Net10 PF |",
        "|---:|---:|---:|---:|---:|---:|",
    ]
    for year in range(START_YEAR, END_YEAR + 1):
        m = result["non_overlapping"][str(year)]
        lines.append(
            f"| {year} | {m['n']} | {fmt(m['mean_gross_bps'])} | {fmt(m['mean_net_10bps'])} | {fmt_pct(m['net10_win_rate'])} | {fmt(m['net10_profit_factor'])} |"
        )

    lines += [
        "",
        "## Interpretation guardrails",
        "",
        "- 2023 is development, 2024 validation, 2025 untouched test for this frozen v0 rule.",
        "- The naive t-stat is descriptive only; minute-level signals are serially correlated, so it is not a valid independent-sample significance test.",
        "- 8 bps represents a round-trip 4 bps taker fee on each side. 10 and 14 bps are stress scenarios adding execution friction.",
        "- Funding is omitted at this gate; for five-minute holding periods it affects only positions crossing a funding timestamp.",
        "- 1m bars cannot test the 30-second horizon or exact intraminute execution. If v0 survives, the next test uses aggTrades / higher-resolution replay.",
        "",
    ]
    return "\n".join(lines)


def fmt(value: float | None) -> str:
    if value is None:
        return "—"
    if math.isinf(value):
        return "∞"
    return f"{value:.3f}"


def fmt_pct(value: float | None) -> str:
    return "—" if value is None else f"{100 * value:.2f}%"


def main() -> int:
    out_dir = Path("research/momentum_v0/results")
    out_dir.mkdir(parents=True, exist_ok=True)

    series = load_series()
    qa_result = qa(series)
    if qa_result["backwards"] or qa_result["duplicates"]:
        raise RuntimeError(f"fatal data ordering issue: {qa_result}")

    trades = build_trades(series)
    non_overlap = non_overlapping_5m(trades)

    result: dict = {
        "method": {
            "symbol": SYMBOL,
            "start_year": START_YEAR,
            "end_year": END_YEAR,
            "signal": "long: r1>0 & r5>0 & imbalance>0; short: inverse",
            "entry": "next_1m_open",
            "cost_bps": list(ROUNDTRIP_COST_BPS),
        },
        "qa": qa_result,
        "years": {},
        "pooled": {},
        "non_overlapping": {},
        "sides_5m": {},
    }

    for year in range(START_YEAR, END_YEAR + 1):
        result["years"][str(year)] = {
            f"{h}m": asdict(directional_metric(trades, year, h)) for h in HORIZONS_MINUTES
        }
        result["sides_5m"][str(year)] = {
            "long": asdict(directional_metric(trades, year, 5, 1)),
            "short": asdict(directional_metric(trades, year, 5, -1)),
        }
        result["non_overlapping"][str(year)] = asdict(
            metric([t for t in non_overlap if t.year == year], 5)
        )

    for h in HORIZONS_MINUTES:
        result["pooled"][f"{h}m"] = asdict(metric(trades, h))

    result["mfe_mae_5m"] = {
        "mean_mfe_bps": statistics.fmean(t.mfe_5m for t in trades) * 10_000 if trades else None,
        "mean_mae_bps": statistics.fmean(t.mae_5m for t in trades) * 10_000 if trades else None,
    }

    json_path = out_dir / "baseline_v0_2023_2025.json"
    md_path = out_dir / "baseline_v0_2023_2025.md"
    json_path.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    md_path.write_text(render_markdown(result), encoding="utf-8")

    print("\n=== JMScore baseline momentum v0 result ===")
    print(render_markdown(result))
    print(f"\nWrote {json_path} and {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
