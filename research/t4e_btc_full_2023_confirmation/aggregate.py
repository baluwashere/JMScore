#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import random
import statistics
from pathlib import Path

SEED = 20230919
PRIMARY_MONTHS = {9, 10, 11, 12}


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


def daily_block_ci(trades: list[dict], draws: int = 10000) -> list[float] | None:
    if not trades:
        return None
    groups: dict[str, list[float]] = {}
    for trade in trades:
        groups.setdefault(str(trade["day"]), []).append(float(trade["net_return"]))
    days = sorted(groups)
    if len(days) < 2:
        return None
    rng = random.Random(SEED)
    means: list[float] = []
    for _ in range(draws):
        vals: list[float] = []
        for _ in days:
            vals.extend(groups[rng.choice(days)])
        means.append(statistics.fmean(vals) * 10_000)
    means.sort()
    return [means[int(0.025 * (draws - 1))], means[int(0.975 * (draws - 1))]]


def with_ci(trades: list[dict]) -> dict:
    return {**metric(trades), "daily_block_bootstrap_95ci_net8_bps": daily_block_ci(trades)}


def fmt(value, digits=3):
    if value is None:
        return "n/a"
    if isinstance(value, float) and math.isinf(value):
        return "inf"
    return f"{value:.{digits}f}"


def main() -> None:
    root = Path("research/t4e_btc_full_2023_confirmation/results")
    months = {}
    for month in range(6, 13):
        path = root / f"month_{month:02d}.json"
        if not path.exists():
            raise RuntimeError(f"missing monthly result {path}")
        months[month] = json.loads(path.read_text(encoding="utf-8"))

    unavailable = [item for m in months.values() for item in m["unavailable_days"]]
    all_trades = [t for m in months.values() for t in m["trades"]]
    primary = [t for month, m in months.items() if month in PRIMARY_MONTHS for t in m["trades"]]
    secondary = [t for month, m in months.items() if month not in PRIMARY_MONTHS for t in m["trades"]]

    primary_metric = with_ci(primary)
    ci = primary_metric["daily_block_bootstrap_95ci_net8_bps"]
    point_ok = (
        primary_metric["n"] >= 100
        and primary_metric["net8_mean_bps"] is not None
        and primary_metric["net8_mean_bps"] > 0
        and primary_metric["net8_pf"] is not None
        and primary_metric["net8_pf"] > 1
    )
    if unavailable:
        decision = "DATA_INCOMPLETE"
    elif point_ok and ci is not None and ci[0] > 0:
        decision = "CONFIRMED_2023"
    elif point_ok:
        decision = "INCONCLUSIVE_2023"
    else:
        decision = "REJECTED_2023"

    monthly = {}
    for month, data in months.items():
        trades = data["trades"]
        monthly[str(month)] = {
            "strategy": with_ci(trades),
            "long": metric([t for t in trades if t["side"] == "LONG"]),
            "short": metric([t for t in trades if t["side"] == "SHORT"]),
            "evaluated_days": len(data["evaluated_days"]),
            "expected_days": len(data["expected_days"]),
            "unavailable_days": data["unavailable_days"],
            "predictive": data.get("predictive"),
        }

    result = {
        "protocol": "research/t4e_btc_full_2023_confirmation/PROTOCOL.md",
        "frozen_formulation": {
            "family": "hist_gradient_boosting",
            "barrier_net_bps": 8.0,
            "long_threshold": 0.80,
            "short_threshold": 0.80,
            "roundtrip_taker_fee_bps": 8.0,
        },
        "decision": decision,
        "primary_sep_dec_unused": primary_metric,
        "primary_long": metric([t for t in primary if t["side"] == "LONG"]),
        "primary_short": metric([t for t in primary if t["side"] == "SHORT"]),
        "secondary_jun_aug_unused": with_ci(secondary),
        "all_unused_jun_dec": with_ci(all_trades),
        "monthly": monthly,
        "unavailable_days": unavailable,
        "counts": {
            "expected_unused_days": sum(len(m["expected_days"]) for m in months.values()),
            "evaluated_unused_days": sum(len(m["evaluated_days"]) for m in months.values()),
            "unavailable_days": len(unavailable),
        },
    }
    (root / "confirmation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    p = result["primary_sep_dec_unused"]
    ci_text = "n/a" if p["daily_block_bootstrap_95ci_net8_bps"] is None else f"[{p['daily_block_bootstrap_95ci_net8_bps'][0]:.2f}, {p['daily_block_bootstrap_95ci_net8_bps'][1]:.2f}]"
    lines = [
        "# T4E-BTC — frozen 2023 confirmation",
        "",
        f"Decision: **{decision}**",
        "",
        "The T4D HGB >8 bps formulation and 0.80/0.80 thresholds were frozen before opening these days. Jev was not used.",
        "",
        "## Primary confirmation — unused Sep–Dec 2023 days",
        "",
        f"- Trades: {p['n']}",
        f"- Gross mean: {fmt(p['gross_mean_bps'])} bps/trade",
        f"- Net after 8 bps fees: {fmt(p['net8_mean_bps'])} bps/trade",
        f"- Win rate: {fmt(100*p['net8_win_rate'] if p['net8_win_rate'] is not None else None, 2)}%",
        f"- Profit factor: {fmt(p['net8_pf'])}",
        f"- Daily-block bootstrap 95% CI: {ci_text} bps",
        "",
        "## By month",
        "",
        "| Month | Days | N | Net8 bps | PF | LONG N | LONG net | SHORT N | SHORT net |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for month in range(6, 13):
        m = monthly[str(month)]
        s, l, sh = m["strategy"], m["long"], m["short"]
        lines.append(
            f"| 2023-{month:02d} | {m['evaluated_days']}/{m['expected_days']} | {s['n']} | {fmt(s['net8_mean_bps'])} | {fmt(s['net8_pf'])} | {l['n']} | {fmt(l['net8_mean_bps'])} | {sh['n']} | {fmt(sh['net8_mean_bps'])} |"
        )
    lines += [
        "",
        "## Data coverage",
        "",
        f"Expected unused days: {result['counts']['expected_unused_days']}",
        f"Evaluated unused days: {result['counts']['evaluated_unused_days']}",
        f"Unavailable days: {result['counts']['unavailable_days']}",
    ]
    (root / "confirmation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"event": "confirmation_done", "decision": decision, "primary": p, "counts": result["counts"]}), flush=True)


if __name__ == "__main__":
    main()
