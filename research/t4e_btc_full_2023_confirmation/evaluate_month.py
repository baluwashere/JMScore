#!/usr/bin/env python3
from __future__ import annotations

import argparse
import calendar
import json
import math
import pickle
import statistics
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
T4D_DIR = ROOT / "research" / "t4d_btc_rare_move_jev"
sys.path.insert(0, str(T4D_DIR))
import run as t4d  # noqa: E402

BARRIER_BPS = 8.0
THRESHOLD = 0.80
EXCLUDED_DAYS = {1, 8, 15, 22}


def profit_factor(values: list[float]) -> float | None:
    gains = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    if losses == 0:
        return None if gains == 0 else math.inf
    return gains / losses


def metric(trades: list[dict]) -> dict:
    if not trades:
        return {"n": 0, "gross_mean_bps": None, "net8_mean_bps": None, "net8_win_rate": None, "net8_pf": None}
    gross = [float(t["gross_return"]) for t in trades]
    net = [float(t["net_return"]) for t in trades]
    return {
        "n": len(trades),
        "gross_mean_bps": statistics.fmean(gross) * 10_000,
        "net8_mean_bps": statistics.fmean(net) * 10_000,
        "net8_win_rate": sum(v > 0 for v in net) / len(net),
        "net8_pf": profit_factor(net),
    }


def select_trades(ds: t4d.Dataset, p_long: np.ndarray, p_short: np.ndarray) -> list[dict]:
    out: list[dict] = []
    next_eligible = -1
    for i in range(len(ds.ts)):
        ts = int(ds.ts[i])
        if ts < next_eligible:
            continue
        long_ok = float(p_long[i]) >= THRESHOLD
        short_ok = float(p_short[i]) >= THRESHOLD
        if not long_ok and not short_ok:
            continue
        if long_ok and short_ok:
            lm = float(p_long[i]) - THRESHOLD
            sm = float(p_short[i]) - THRESHOLD
            if abs(lm - sm) < 1e-15:
                continue
            side = 1 if lm > sm else -1
        else:
            side = 1 if long_ok else -1
        gross = float(ds.long_gross[i] if side == 1 else ds.short_gross[i])
        net = float(ds.long_net[i] if side == 1 else ds.short_net[i])
        out.append({
            "ts": ts,
            "day": date.fromtimestamp(ts / 1000).isoformat(),
            "side": "LONG" if side == 1 else "SHORT",
            "p_long": float(p_long[i]),
            "p_short": float(p_short[i]),
            "gross_return": gross,
            "net_return": net,
        })
        next_eligible = ts + (t4d.HORIZON_SEC + 1) * 1000
    return out


def evaluate_day(day: date, models: dict) -> tuple[dict, list[dict]]:
    ds, qas = t4d.build_dataset((day,))
    if len(ds.ts) == 0:
        raise RuntimeError(f"no usable rows for {day.isoformat()}")
    p_long = models["long"].predict_proba(ds.X)[:, 1]
    p_short = models["short"].predict_proba(ds.X)[:, 1]
    y_long = t4d.label(ds, 1, BARRIER_BPS)
    y_short = t4d.label(ds, -1, BARRIER_BPS)
    trades = select_trades(ds, p_long, p_short)
    qa = qas[0].__dict__
    qa.update({
        "rows": int(len(ds.ts)),
        "long_predictive": t4d.binary_metrics(y_long, p_long),
        "short_predictive": t4d.binary_metrics(y_short, p_short),
        "strategy": metric(trades),
        "long_strategy": metric([t for t in trades if t["side"] == "LONG"]),
        "short_strategy": metric([t for t in trades if t["side"] == "SHORT"]),
    })
    return qa, trades


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", type=int, required=True, choices=range(6, 13))
    args = ap.parse_args()

    model_path = Path("research/t4e_btc_full_2023_confirmation/model/frozen_hgb_barrier8.pkl")
    with model_path.open("rb") as fh:
        bundle = pickle.load(fh)
    metadata = bundle["metadata"]
    if metadata["family"] != "hist_gradient_boosting" or float(metadata["barrier_net_bps"]) != BARRIER_BPS:
        raise RuntimeError("frozen model metadata mismatch")
    if float(metadata["long_threshold"]) != THRESHOLD or float(metadata["short_threshold"]) != THRESHOLD:
        raise RuntimeError("frozen threshold metadata mismatch")
    if list(metadata["feature_names"]) != list(t4d.FEATURE_NAMES):
        raise RuntimeError("feature contract mismatch")

    _, days_in_month = calendar.monthrange(2023, args.month)
    days = [date(2023, args.month, d) for d in range(1, days_in_month + 1) if d not in EXCLUDED_DAYS]

    all_qa: list[dict] = []
    all_trades: list[dict] = []
    unavailable: list[dict] = []
    for day in days:
        try:
            qa, trades = evaluate_day(day, bundle["models"])
            all_qa.append(qa)
            all_trades.extend(trades)
            print(json.dumps({"event": "confirm_day_done", "day": day.isoformat(), "rows": qa["rows"], "trades": len(trades)}), flush=True)
        except Exception as exc:
            unavailable.append({"day": day.isoformat(), "error": str(exc)})
            print(json.dumps({"event": "confirm_day_unavailable", "day": day.isoformat(), "error": str(exc)}), flush=True)

    result = {
        "month": args.month,
        "expected_days": [d.isoformat() for d in days],
        "evaluated_days": [q["day"] for q in all_qa],
        "unavailable_days": unavailable,
        "qa": all_qa,
        "trades": all_trades,
        "strategy": metric(all_trades),
        "long_strategy": metric([t for t in all_trades if t["side"] == "LONG"]),
        "short_strategy": metric([t for t in all_trades if t["side"] == "SHORT"]),
    }

    out = Path("research/t4e_btc_full_2023_confirmation/results")
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"month_{args.month:02d}.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"event": "month_done", "month": args.month, "strategy": result["strategy"], "unavailable": len(unavailable)}), flush=True)


if __name__ == "__main__":
    main()
