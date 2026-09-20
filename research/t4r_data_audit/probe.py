#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import json
import os
import statistics
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

SYMBOL = "BTCUSDT"
DAY = "2023-09-15"
MONTH = "2023-09"
BASE = "https://data.binance.vision/data/futures/um"
UA = "JMScore-T4R-data-audit/1.0"
MAX_ROWS = 200_000

DATASETS = {
    "aggTrades": f"{BASE}/daily/aggTrades/{SYMBOL}/{SYMBOL}-aggTrades-{DAY}.zip",
    "bookTicker": f"{BASE}/daily/bookTicker/{SYMBOL}/{SYMBOL}-bookTicker-{DAY}.zip",
    "bookDepth": f"{BASE}/daily/bookDepth/{SYMBOL}/{SYMBOL}-bookDepth-{DAY}.zip",
    "metrics": f"{BASE}/daily/metrics/{SYMBOL}/{SYMBOL}-metrics-{DAY}.zip",
    "liquidationSnapshot": f"{BASE}/daily/liquidationSnapshot/{SYMBOL}/{SYMBOL}-liquidationSnapshot-{DAY}.zip",
    "markPriceKlines_1m": f"{BASE}/daily/markPriceKlines/{SYMBOL}/1m/{SYMBOL}-1m-{DAY}.zip",
    "indexPriceKlines_1m": f"{BASE}/daily/indexPriceKlines/{SYMBOL}/1m/{SYMBOL}-1m-{DAY}.zip",
    "premiumIndexKlines_1m": f"{BASE}/daily/premiumIndexKlines/{SYMBOL}/1m/{SYMBOL}-1m-{DAY}.zip",
    "fundingRate_monthly": f"{BASE}/monthly/fundingRate/{SYMBOL}/{SYMBOL}-fundingRate-{MONTH}.zip",
}


def request(url: str, method: str = "GET"):
    req = urllib.request.Request(url, headers={"User-Agent": UA}, method=method)
    return urllib.request.urlopen(req, timeout=120)


def status_only(url: str) -> tuple[int | None, dict[str, str], str | None]:
    try:
        with request(url, "HEAD") as r:
            return r.status, dict(r.headers), None
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), str(e)
    except Exception as e:
        return None, {}, repr(e)


def download(url: str, path: Path) -> tuple[int, int]:
    h = hashlib.sha256()
    total = 0
    with request(url, "GET") as r, path.open("wb") as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            h.update(chunk)
            total += len(chunk)
    return total, int(h.hexdigest(), 16)


def verify_checksum(url: str, zip_path: Path) -> dict:
    checksum_url = url + ".CHECKSUM"
    status, _, err = status_only(checksum_url)
    if status != 200:
        return {"available": False, "status": status, "error": err}
    with request(checksum_url) as r:
        expected = r.read().decode("utf-8", errors="replace").strip().split()[0].lower()
    actual = hashlib.sha256(zip_path.read_bytes()).hexdigest().lower()
    return {"available": True, "expected": expected, "actual": actual, "match": expected == actual}


def guess_timestamp_columns(header: list[str]) -> list[int]:
    out = []
    for i, name in enumerate(header):
        n = name.lower().strip()
        if any(k in n for k in ("time", "timestamp", "create_time")):
            out.append(i)
    return out


def parse_numeric_time(v: str) -> float | None:
    x = v.strip()
    if not x:
        return None
    try:
        f = float(x)
    except ValueError:
        return None
    if f > 1e14:
        f /= 1e3
    if f > 1e11:
        f /= 1e3
    return f


def inspect_zip(path: Path, dataset: str) -> dict:
    with zipfile.ZipFile(path) as zf:
        members = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not members:
            return {"csv_member": None, "error": "no csv member"}
        member = members[0]
        with zf.open(member) as raw:
            text = (line.decode("utf-8", errors="replace") for line in raw)
            reader = csv.reader(text)
            try:
                first = next(reader)
            except StopIteration:
                return {"csv_member": member, "error": "empty csv"}

            header_like = any(any(c.isalpha() for c in cell) for cell in first)
            header = [c.strip() for c in first] if header_like else [f"col_{i}" for i in range(len(first))]
            rows = [] if header_like else [first]
            for i, row in enumerate(reader):
                rows.append(row)
                if i + 1 >= MAX_ROWS:
                    break

    out: dict = {
        "csv_member": member,
        "header": header,
        "sampled_rows": len(rows),
        "first_rows": rows[:3],
    }
    ts_cols = guess_timestamp_columns(header)
    if not ts_cols and dataset == "aggTrades":
        ts_cols = [5]
    if not ts_cols and dataset == "bookTicker":
        ts_cols = [5, 6]
    if ts_cols:
        ts_stats = {}
        for idx in ts_cols:
            vals = []
            for r in rows:
                if idx < len(r):
                    v = parse_numeric_time(r[idx])
                    if v is not None:
                        vals.append(v)
            if len(vals) >= 2:
                deltas = [b - a for a, b in zip(vals, vals[1:])]
                positive = [d for d in deltas if d > 0]
                ts_stats[header[idx] if idx < len(header) else str(idx)] = {
                    "n": len(vals),
                    "backwards": sum(d < 0 for d in deltas),
                    "duplicates": sum(d == 0 for d in deltas),
                    "median_positive_delta_s": statistics.median(positive) if positive else None,
                }
        out["timestamp_stats"] = ts_stats

    if dataset == "bookTicker" and rows:
        # Historical BTC/ETH files have had ordering problems. Check update_id monotonicity too.
        ids = []
        for r in rows:
            try:
                ids.append(int(r[0]))
            except (ValueError, IndexError):
                pass
        if len(ids) >= 2:
            out["update_id_backwards"] = sum(b < a for a, b in zip(ids, ids[1:]))

    if dataset == "bookDepth":
        lowered = [h.lower() for h in header]
        out["is_price_level_l2"] = not ({"percentage", "depth", "notional"}.issubset(set(lowered)))
        if "percentage" in lowered:
            pidx = lowered.index("percentage")
            pvals = []
            for r in rows:
                try:
                    pvals.append(float(r[pidx]))
                except (ValueError, IndexError):
                    pass
            out["percentage_values"] = sorted(set(pvals))[:50]
            # cadence across unique textual timestamps
            tidx = lowered.index("timestamp") if "timestamp" in lowered else None
            if tidx is not None:
                stamps = []
                for r in rows:
                    if tidx < len(r) and (not stamps or r[tidx] != stamps[-1]):
                        stamps.append(r[tidx])
                out["unique_snapshot_timestamps_sampled"] = len(stamps)
                out["first_snapshot_timestamps"] = stamps[:5]

    return out


def classify(name: str, status: int | None, checksum: dict, detail: dict) -> dict:
    if status != 200:
        return {"class": "UNSUITABLE", "reason": f"archive unavailable HTTP {status}"}
    if checksum.get("available") and not checksum.get("match"):
        return {"class": "UNSUITABLE", "reason": "checksum mismatch"}
    if name == "aggTrades":
        return {"class": "RELIABLE", "supports": ["trade price/qty", "aggressor side", "trade-flow imbalance", "volume shocks"]}
    if name == "bookTicker":
        return {"class": "RELIABLE", "supports": ["BBO", "spread", "L1 imbalance", "microprice"], "caveat": "must sort by event_time/update_id when source order is non-monotonic"}
    if name == "bookDepth":
        if detail.get("is_price_level_l2") is False:
            return {"class": "PARTIAL", "supports": ["coarse depth/liquidity regime by percentage band"], "cannot_support": ["price-level L2", "adds/cancels", "queue depletion", "replenishment", "exact OFI"]}
        return {"class": "PARTIAL", "reason": "schema requires manual review"}
    if name == "liquidationSnapshot":
        return {"class": "PARTIAL", "supports": ["liquidation events"], "caveat": "coverage/availability must be checked across target period"}
    if name == "metrics":
        return {"class": "PARTIAL", "supports": ["open-interest/positioning regime"], "caveat": "coarser cadence and known archive quality caveats; not microsecond execution data"}
    if "Klines" in name:
        return {"class": "PARTIAL", "supports": ["mark/index/premium regime"], "caveat": "bar data only; not order-book microstructure"}
    if name == "fundingRate_monthly":
        return {"class": "PARTIAL", "supports": ["funding regime"], "caveat": "slow-moving context only"}
    return {"class": "PARTIAL", "reason": "available but semantics not yet classified"}


def main() -> None:
    result = {
        "symbol": SYMBOL,
        "probe_day": DAY,
        "probe_month": MONTH,
        "datasets": {},
        "l2_gate": {},
        "authenticated_l2_candidate": {
            "endpoint": "/sapi/v1/futures/histDataLink",
            "data_types": ["T_DEPTH", "S_DEPTH", "T_DEPTH_BACKFILL"],
            "status": "REQUIRES_AUTH_AND_CURRENT_AVAILABILITY_VERIFICATION",
            "public_archive_equivalent": False,
        },
    }

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        for name, url in DATASETS.items():
            print(json.dumps({"event": "probe", "dataset": name, "url": url}), flush=True)
            status, headers, error = status_only(url)
            entry: dict = {
                "url": url,
                "http_status": status,
                "head_error": error,
                "content_length": headers.get("Content-Length"),
            }
            if status == 200:
                path = root / f"{name}.zip"
                try:
                    size, _ = download(url, path)
                    entry["downloaded_bytes"] = size
                    entry["checksum"] = verify_checksum(url, path)
                    entry["detail"] = inspect_zip(path, name)
                except Exception as e:
                    entry["download_error"] = repr(e)
                    entry.setdefault("checksum", {})
                    entry.setdefault("detail", {})
            else:
                entry["checksum"] = {}
                entry["detail"] = {}
            entry["classification"] = classify(name, status, entry["checksum"], entry["detail"])
            result["datasets"][name] = entry

    bd = result["datasets"].get("bookDepth", {})
    bt = result["datasets"].get("bookTicker", {})
    true_l2 = bool(
        bd.get("http_status") == 200
        and bd.get("detail", {}).get("is_price_level_l2") is True
    )
    result["l2_gate"] = {
        "public_true_l2_reconstructible": true_l2,
        "bbo_available": bt.get("http_status") == 200,
        "decision": "PUBLIC_L2_AVAILABLE" if true_l2 else "PUBLIC_L2_NOT_RECONSTRUCTIBLE",
        "safe_now": ["aggTrades flow features", "BBO/spread", "L1 imbalance", "microprice", "coarse depth-band regime if bookDepth validates"],
        "requires_true_l2_source": ["L5/L20 exact imbalance", "adds/cancels", "queue depletion", "replenishment", "depth slope by exact levels", "exact order-flow imbalance from book updates", "absorption against opposing depth"],
    }

    out = Path("research/t4r_data_audit/results")
    out.mkdir(parents=True, exist_ok=True)
    (out / "audit.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    lines = [
        "# T4R-1 — BTC historical data capability audit",
        "",
        f"Probe date: **{DAY}**",
        "",
        f"L2 gate: **{result['l2_gate']['decision']}**",
        "",
        "| Dataset | HTTP | Classification | Key use / limitation |",
        "|---|---:|---|---|",
    ]
    for name, entry in result["datasets"].items():
        c = entry["classification"]
        text = "; ".join(c.get("supports", []))
        if c.get("cannot_support"):
            text += "; cannot: " + ", ".join(c["cannot_support"])
        if c.get("caveat"):
            text += "; caveat: " + c["caveat"]
        if c.get("reason"):
            text += "; " + c["reason"]
        lines.append(f"| {name} | {entry.get('http_status')} | {c['class']} | {text} |")
    lines += [
        "",
        "## L2 decision",
        "",
        "Public `bookDepth` counts as true L2 only if it contains chronological exact price-level state/update information. Percentage-band depth does not pass this gate.",
        "",
        "## Authenticated Binance L2 candidate",
        "",
        "The legacy/current authenticated `histDataLink` route is recorded separately and must be tested with credentials before assuming T_DEPTH/S_DEPTH are obtainable for the required historical period.",
    ]
    (out / "audit.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"event": "decision", **result["l2_gate"]}), flush=True)


if __name__ == "__main__":
    main()
