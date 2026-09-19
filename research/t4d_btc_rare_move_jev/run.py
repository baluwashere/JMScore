#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import random
import statistics
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SYMBOL = "BTCUSDT"
BASE_URL = "https://data.binance.vision/data/futures/um/daily"
USER_AGENT = "JMScore-research/0.3"
SECONDS = 86_400
DECISION_STEP_SEC = 30
HORIZON_SEC = 300
TAKER_ROUNDTRIP = 0.0008
THRESHOLDS = (0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.65, 0.70, 0.75, 0.80)
BARRIER_BPS = (0.0, 4.0, 8.0, 12.0)
SAMPLED_DAYS = (1, 8, 15, 22)
SEED = 20230919

TRAIN_DATES = tuple(date(2023, m, d) for m in (6, 7) for d in SAMPLED_DAYS)
CAL_DATES = tuple(date(2023, 8, d) for d in SAMPLED_DAYS)
HOLDOUT_DATES = tuple(date(2023, m, d) for m in (9, 10, 11, 12) for d in SAMPLED_DAYS)

FEATURE_NAMES = (
    "return_5s", "return_15s", "return_30s", "return_60s", "return_300s",
    "realized_vol_30s", "realized_vol_60s", "realized_vol_300s",
    "volume_imbalance_5s", "volume_imbalance_15s", "volume_imbalance_30s", "volume_imbalance_60s",
    "count_imbalance_5s", "count_imbalance_15s", "count_imbalance_30s", "count_imbalance_60s",
    "flow_accel_5v30", "flow_accel_15v60", "volume_z_30s_vs_20",
    "spread_bps", "book_imbalance_l1", "microprice_delta_bps", "quote_updates_30s",
)


@dataclass
class Dataset:
    X: np.ndarray
    ts: np.ndarray
    long_gross: np.ndarray
    short_gross: np.ndarray
    long_net: np.ndarray
    short_net: np.ndarray


@dataclass
class DayQA:
    day: str
    agg_rows: int
    book_rows: int
    crossed_quotes: int
    usable_snapshots: int
    candidate_snapshots: int
    agg_zip_bytes: int
    book_zip_bytes: int


def request_bytes(url: str, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"download failed after {attempts} attempts: {url}: {last}")


def normalize_ts(raw: str) -> int:
    value = int(raw)
    if value > 100_000_000_000_000:
        value //= 1_000
    return value


def archive_url(kind: str, day: date) -> str:
    name = f"{SYMBOL}-{kind}-{day.isoformat()}.zip"
    return f"{BASE_URL}/{kind}/{SYMBOL}/{name}"


def fetch_verified(kind: str, day: date) -> bytes:
    url = archive_url(kind, day)
    blob = request_bytes(url)
    checksum = request_bytes(url + ".CHECKSUM").decode("utf-8", errors="replace").strip().split()[0].lower()
    actual = hashlib.sha256(blob).hexdigest().lower()
    if actual != checksum:
        raise RuntimeError(f"checksum mismatch for {url}: {actual} != {checksum}")
    return blob


def boolish(value: str) -> bool:
    return value.strip().lower() in ("true", "1", "t")


def csv_rows(blob: bytes):
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(names) != 1:
            raise RuntimeError(f"expected one csv, got {names}")
        with zf.open(names[0]) as raw:
            yield from csv.reader(io.TextIOWrapper(raw, encoding="utf-8", newline=""))


def carry_forward(values: list[np.ndarray], event_sec: np.ndarray) -> tuple[list[np.ndarray], np.ndarray]:
    out = [v.copy() for v in values]
    age = np.full(SECONDS, 10**9, dtype=np.int32)
    last_vals = [math.nan] * len(values)
    last_sec = -10**9
    for sec in range(SECONDS):
        if event_sec[sec] >= 0:
            last_sec = int(event_sec[sec])
            for idx, arr in enumerate(values):
                last_vals[idx] = float(arr[sec])
        if last_sec >= 0:
            for idx, arr in enumerate(out):
                arr[sec] = last_vals[idx]
            age[sec] = sec - last_sec
    return out, age


def parse_day(day: date) -> tuple[dict[str, np.ndarray], DayQA]:
    start_ms = int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)
    agg_blob = fetch_verified("aggTrades", day)
    book_blob = fetch_verified("bookTicker", day)

    last_price_raw = np.full(SECONDS, np.nan, dtype=np.float64)
    trade_event_sec = np.full(SECONDS, -1, dtype=np.int32)
    buy_qty = np.zeros(SECONDS, dtype=np.float64)
    sell_qty = np.zeros(SECONDS, dtype=np.float64)
    buy_count = np.zeros(SECONDS, dtype=np.float64)
    sell_count = np.zeros(SECONDS, dtype=np.float64)
    agg_rows = 0

    for row in csv_rows(agg_blob):
        if not row:
            continue
        try:
            ts = normalize_ts(row[5])
            px = float(row[1]); qty = float(row[2]); maker = boolish(row[6])
        except (ValueError, IndexError):
            continue
        sec = (ts - start_ms) // 1000
        if sec < 0 or sec >= SECONDS or px <= 0 or qty <= 0:
            continue
        sec = int(sec)
        last_price_raw[sec] = px
        trade_event_sec[sec] = sec
        if maker:
            sell_qty[sec] += qty; sell_count[sec] += 1
        else:
            buy_qty[sec] += qty; buy_count[sec] += 1
        agg_rows += 1

    bid_raw = np.full(SECONDS, np.nan, dtype=np.float64)
    ask_raw = np.full(SECONDS, np.nan, dtype=np.float64)
    bidq_raw = np.full(SECONDS, np.nan, dtype=np.float64)
    askq_raw = np.full(SECONDS, np.nan, dtype=np.float64)
    quote_event_sec = np.full(SECONDS, -1, dtype=np.int32)
    quote_best_event_ms = np.full(SECONDS, -1, dtype=np.int64)
    quote_best_update = np.full(SECONDS, -1, dtype=np.int64)
    quote_updates = np.zeros(SECONDS, dtype=np.float64)
    book_rows = crossed = 0

    for row in csv_rows(book_blob):
        if not row:
            continue
        try:
            update_id = int(row[0])
            bid = float(row[1]); bidq = float(row[2]); ask = float(row[3]); askq = float(row[4])
            event_ms = normalize_ts(row[6])
        except (ValueError, IndexError):
            continue
        sec = (event_ms - start_ms) // 1000
        if sec < 0 or sec >= SECONDS or min(bid, bidq, ask, askq) <= 0:
            continue
        sec = int(sec)
        book_rows += 1
        quote_updates[sec] += 1
        if bid >= ask:
            crossed += 1
            continue
        if event_ms > quote_best_event_ms[sec] or (event_ms == quote_best_event_ms[sec] and update_id > quote_best_update[sec]):
            quote_best_event_ms[sec] = event_ms
            quote_best_update[sec] = update_id
            quote_event_sec[sec] = sec
            bid_raw[sec] = bid; ask_raw[sec] = ask; bidq_raw[sec] = bidq; askq_raw[sec] = askq

    [price], trade_age = carry_forward([last_price_raw], trade_event_sec)
    [bid, ask, bidq, askq], quote_age = carry_forward([bid_raw, ask_raw, bidq_raw, askq_raw], quote_event_sec)

    prefix_buy = np.concatenate(([0.0], np.cumsum(buy_qty)))
    prefix_sell = np.concatenate(([0.0], np.cumsum(sell_qty)))
    prefix_bc = np.concatenate(([0.0], np.cumsum(buy_count)))
    prefix_sc = np.concatenate(([0.0], np.cumsum(sell_count)))
    prefix_quotes = np.concatenate(([0.0], np.cumsum(quote_updates)))

    logret = np.zeros(SECONDS, dtype=np.float64)
    valid_pair = np.isfinite(price[1:]) & np.isfinite(price[:-1]) & (price[1:] > 0) & (price[:-1] > 0)
    logret[1:][valid_pair] = np.log(price[1:][valid_pair] / price[:-1][valid_pair])
    prefix_sqlogret = np.concatenate(([0.0], np.cumsum(logret * logret)))

    state = {
        "price": price, "trade_age": trade_age, "bid": bid, "ask": ask, "bidq": bidq, "askq": askq,
        "quote_age": quote_age, "prefix_buy": prefix_buy, "prefix_sell": prefix_sell,
        "prefix_bc": prefix_bc, "prefix_sc": prefix_sc, "prefix_quotes": prefix_quotes,
        "prefix_sqlogret": prefix_sqlogret,
    }
    qa = DayQA(day.isoformat(), agg_rows, book_rows, crossed, 0, 0, len(agg_blob), len(book_blob))
    return state, qa


def wsum(prefix: np.ndarray, t: int, window: int) -> float:
    start = t - window + 1
    return float(prefix[t + 1] - prefix[start])


def imbalance(pos: float, neg: float) -> float:
    total = pos + neg
    return 0.0 if total <= 0 else (pos - neg) / total


def make_feature_row(state: dict[str, np.ndarray], t: int) -> tuple[list[float], float, float] | None:
    price = state["price"]; trade_age = state["trade_age"]
    bid = state["bid"]; ask = state["ask"]; bidq = state["bidq"]; askq = state["askq"]; quote_age = state["quote_age"]
    if t < 600 or t + HORIZON_SEC + 1 >= SECONDS:
        return None
    required_price_secs = (t, t-5, t-15, t-30, t-60, t-300)
    if any(not np.isfinite(price[s]) or trade_age[s] > 5 for s in required_price_secs):
        return None
    entry_s = t + 1; exit_s = t + HORIZON_SEC + 1
    if any(quote_age[s] > 2 for s in (t, entry_s, exit_s)):
        return None
    if not all(np.isfinite(v) for v in (bid[t], ask[t], bidq[t], askq[t], bid[entry_s], ask[entry_s], bid[exit_s], ask[exit_s])):
        return None
    if bid[t] >= ask[t] or bid[entry_s] >= ask[entry_s] or bid[exit_s] >= ask[exit_s]:
        return None

    returns = [price[t] / price[t-w] - 1.0 for w in (5, 15, 30, 60, 300)]
    vols = [math.sqrt(max(0.0, wsum(state["prefix_sqlogret"], t, w))) for w in (30, 60, 300)]

    volume_imbalances=[]; count_imbalances=[]
    for w in (5,15,30,60):
        b=wsum(state["prefix_buy"],t,w); s=wsum(state["prefix_sell"],t,w)
        bc=wsum(state["prefix_bc"],t,w); sc=wsum(state["prefix_sc"],t,w)
        volume_imbalances.append(imbalance(b,s)); count_imbalances.append(imbalance(bc,sc))

    current30 = wsum(state["prefix_buy"],t,30)+wsum(state["prefix_sell"],t,30)
    prev=[]
    for k in range(1,21):
        end=t-k*30
        b=wsum(state["prefix_buy"],end,30); s=wsum(state["prefix_sell"],end,30)
        prev.append(b+s)
    mean=statistics.fmean(prev); std=statistics.pstdev(prev)
    if std <= 0:
        return None
    volume_z=(current30-mean)/std

    mid=(bid[t]+ask[t])/2
    spread_bps=(ask[t]-bid[t])/mid*10_000
    qtotal=bidq[t]+askq[t]
    if qtotal <= 0:
        return None
    book_imb=(bidq[t]-askq[t])/qtotal
    micro=(ask[t]*bidq[t]+bid[t]*askq[t])/qtotal
    micro_delta=(micro-mid)/mid*10_000
    quote_updates30=wsum(state["prefix_quotes"],t,30)

    features = returns + vols + volume_imbalances + count_imbalances + [
        volume_imbalances[0]-volume_imbalances[2],
        volume_imbalances[1]-volume_imbalances[3],
        volume_z, spread_bps, book_imb, micro_delta, quote_updates30,
    ]
    if len(features) != len(FEATURE_NAMES) or not all(math.isfinite(x) for x in features):
        return None

    long_gross=bid[exit_s]/ask[entry_s]-1.0
    short_gross=bid[entry_s]/ask[exit_s]-1.0
    return features, long_gross, short_gross


def build_dataset(days: tuple[date, ...]) -> tuple[Dataset, list[DayQA]]:
    rows=[]; timestamps=[]; lg=[]; sg=[]; qas=[]
    for day in days:
        print(json.dumps({"event":"day_start","day":day.isoformat()}), flush=True)
        state, qa = parse_day(day)
        start_ms=int(datetime(day.year,day.month,day.day,tzinfo=timezone.utc).timestamp()*1000)
        candidates=0; before=len(timestamps)
        for t in range(600, SECONDS-HORIZON_SEC-2, DECISION_STEP_SEC):
            candidates += 1
            item=make_feature_row(state,t)
            if item is None:
                continue
            feat,long_gross,short_gross=item
            rows.append(feat); timestamps.append(start_ms+t*1000); lg.append(long_gross); sg.append(short_gross)
        qa.candidate_snapshots=candidates; qa.usable_snapshots=len(timestamps)-before
        qas.append(qa)
        print(json.dumps({"event":"day_done", **qa.__dict__}), flush=True)
    X=np.asarray(rows,dtype=np.float64); ts=np.asarray(timestamps,dtype=np.int64)
    long_gross=np.asarray(lg); short_gross=np.asarray(sg)
    return Dataset(X,ts,long_gross,short_gross,long_gross-TAKER_ROUNDTRIP,short_gross-TAKER_ROUNDTRIP), qas


def pf(values: list[float]) -> float | None:
    gains=sum(v for v in values if v>0); losses=-sum(v for v in values if v<0)
    if losses == 0:
        return None if gains == 0 else math.inf
    return gains/losses


def binary_metrics(y: np.ndarray, p: np.ndarray) -> dict:
    if len(np.unique(y)) < 2:
        return {"roc_auc":None,"brier":float(np.mean((p-y)**2)),"n":int(len(y)),"positive_rate":float(np.mean(y))}
    return {"roc_auc":float(roc_auc_score(y,p)),"brier":float(np.mean((p-y)**2)),"n":int(len(y)),"positive_rate":float(np.mean(y))}


def side_metric(ds: Dataset, p: np.ndarray, threshold: float, side: int) -> dict:
    gross=[]; net=[]; selected_ts=[]; next_eligible=-1
    for i,prob in enumerate(p):
        ts=int(ds.ts[i])
        if ts < next_eligible or prob < threshold:
            continue
        g=float(ds.long_gross[i] if side==1 else ds.short_gross[i])
        n=float(ds.long_net[i] if side==1 else ds.short_net[i])
        gross.append(g); net.append(n); selected_ts.append(ts)
        next_eligible=ts+(HORIZON_SEC+1)*1000
    if not net:
        return {"n":0,"gross_mean_bps":None,"net8_mean_bps":None,"net8_win_rate":None,"net8_pf":None}
    return {"n":len(net),"gross_mean_bps":statistics.fmean(gross)*10_000,"net8_mean_bps":statistics.fmean(net)*10_000,"net8_win_rate":sum(v>0 for v in net)/len(net),"net8_pf":pf(net)}


def choose_side_threshold(ds: Dataset, p: np.ndarray, side: int) -> tuple[float, list[dict]]:
    table=[]
    for threshold in THRESHOLDS:
        m=side_metric(ds,p,threshold,side)
        table.append({"threshold":threshold,**m})
    eligible=[r for r in table if r["n"]>=25]
    if not eligible:
        return THRESHOLDS[-1],table
    eligible.sort(key=lambda r:(r["net8_mean_bps"] if r["net8_mean_bps"] is not None else -math.inf),reverse=True)
    return float(eligible[0]["threshold"]),table


def combined_metric(ds: Dataset, p_long: np.ndarray, p_short: np.ndarray, long_threshold: float, short_threshold: float) -> dict:
    gross=[]; net=[]; sides=[]; selected_ts=[]; next_eligible=-1
    for i in range(len(ds.ts)):
        ts=int(ds.ts[i])
        if ts < next_eligible:
            continue
        long_ok=p_long[i]>=long_threshold
        short_ok=p_short[i]>=short_threshold
        if not long_ok and not short_ok:
            continue
        if long_ok and short_ok:
            long_margin=float(p_long[i]-long_threshold)
            short_margin=float(p_short[i]-short_threshold)
            if abs(long_margin-short_margin) < 1e-15:
                continue
            side=1 if long_margin>short_margin else -1
        else:
            side=1 if long_ok else -1
        g=float(ds.long_gross[i] if side==1 else ds.short_gross[i])
        n=float(ds.long_net[i] if side==1 else ds.short_net[i])
        gross.append(g); net.append(n); sides.append(side); selected_ts.append(ts)
        next_eligible=ts+(HORIZON_SEC+1)*1000
    if not net:
        return {"n":0,"gross_mean_bps":None,"net8_mean_bps":None,"net8_win_rate":None,"net8_pf":None,"long_n":0,"short_n":0,"selected_ts":[],"net_values":[]}
    return {"n":len(net),"gross_mean_bps":statistics.fmean(gross)*10_000,"net8_mean_bps":statistics.fmean(net)*10_000,"net8_win_rate":sum(v>0 for v in net)/len(net),"net8_pf":pf(net),"long_n":sum(s==1 for s in sides),"short_n":sum(s==-1 for s in sides),"selected_ts":selected_ts,"net_values":net}


def strip_internal(metric: dict) -> dict:
    return {k:v for k,v in metric.items() if k not in ("selected_ts","net_values")}


def daily_block_ci(metric: dict, draws: int=2000) -> list[float] | None:
    if not metric["net_values"]:
        return None
    groups={}
    for ts,val in zip(metric["selected_ts"],metric["net_values"]):
        groups.setdefault(ts//86_400_000,[]).append(val)
    days=list(groups)
    if len(days)<2:
        return None
    rng=random.Random(SEED); means=[]
    for _ in range(draws):
        vals=[]
        for _ in days:
            vals.extend(groups[rng.choice(days)])
        means.append(statistics.fmean(vals)*10_000)
    means.sort()
    return [means[int(.025*(draws-1))],means[int(.975*(draws-1))]]


def make_model(family: str):
    if family == "logistic_regression":
        return Pipeline([("scale",StandardScaler()),("model",LogisticRegression(C=1.0,max_iter=500,random_state=SEED))])
    if family == "hist_gradient_boosting":
        return HistGradientBoostingClassifier(max_depth=3,learning_rate=0.05,max_iter=150,l2_regularization=1.0,random_state=SEED)
    raise ValueError(family)


def label(ds: Dataset, side: int, barrier_bps: float) -> np.ndarray:
    values=ds.long_net if side==1 else ds.short_net
    return (values > barrier_bps/10_000).astype(np.int8)


def fit_side(family: str, side: int, barrier_bps: float, train: Dataset, cal: Dataset, hold: Dataset) -> dict:
    y_train=label(train,side,barrier_bps); y_cal=label(cal,side,barrier_bps); y_hold=label(hold,side,barrier_bps)
    if len(np.unique(y_train)) < 2:
        raise RuntimeError(f"single-class train label family={family} side={side} barrier={barrier_bps}")
    model=make_model(family); model.fit(train.X,y_train)
    p_train=model.predict_proba(train.X)[:,1]; p_cal=model.predict_proba(cal.X)[:,1]; p_hold=model.predict_proba(hold.X)[:,1]
    threshold,table=choose_side_threshold(cal,p_cal,side)
    return {
        "model":model,"threshold":threshold,"threshold_table":table,
        "p_train":p_train,"p_cal":p_cal,"p_hold":p_hold,
        "predictive":{"train":binary_metrics(y_train,p_train),"calibration":binary_metrics(y_cal,p_cal),"holdout":binary_metrics(y_hold,p_hold)},
    }


def evaluate_formulation(family: str, barrier_bps: float, train: Dataset, cal: Dataset, hold: Dataset) -> dict:
    long=fit_side(family,1,barrier_bps,train,cal,hold)
    short=fit_side(family,-1,barrier_bps,train,cal,hold)
    cal_strategy=combined_metric(cal,long["p_cal"],short["p_cal"],long["threshold"],short["threshold"])
    hold_strategy=combined_metric(hold,long["p_hold"],short["p_hold"],long["threshold"],short["threshold"])
    ci=daily_block_ci(hold_strategy)
    cal_public=strip_internal(cal_strategy); hold_public=strip_internal(hold_strategy)
    gate=(hold_public["n"]>=100 and hold_public["net8_mean_bps"] is not None and hold_public["net8_mean_bps"]>0 and (hold_public["net8_pf"] or 0)>1 and cal_public["net8_mean_bps"] is not None and cal_public["net8_mean_bps"]>0)
    return {
        "family":family,"barrier_net_bps":barrier_bps,
        "long":{"threshold":long["threshold"],"predictive":long["predictive"],"calibration_threshold_table":long["threshold_table"]},
        "short":{"threshold":short["threshold"],"predictive":short["predictive"],"calibration_threshold_table":short["threshold_table"]},
        "calibration_strategy":cal_public,"holdout_strategy":hold_public,
        "holdout_daily_block_bootstrap_95ci_net8_bps":ci,"passes_pilot_gate":gate,
    }


def dataset_summary(ds: Dataset) -> dict:
    return {"rows":int(len(ds.ts)),"features":len(FEATURE_NAMES),"start_ts":int(ds.ts.min()) if len(ds.ts) else None,"end_ts":int(ds.ts.max()) if len(ds.ts) else None,
            "long_net_positive_rate":float(np.mean(ds.long_net>0)) if len(ds.ts) else None,"short_net_positive_rate":float(np.mean(ds.short_net>0)) if len(ds.ts) else None}


def main() -> None:
    train,qa_train=build_dataset(TRAIN_DATES)
    cal,qa_cal=build_dataset(CAL_DATES)
    hold,qa_hold=build_dataset(HOLDOUT_DATES)
    if min(len(train.ts),len(cal.ts),len(hold.ts))==0:
        raise RuntimeError("empty dataset split")

    formulations=[]
    for family in ("logistic_regression","hist_gradient_boosting"):
        for barrier in BARRIER_BPS:
            print(json.dumps({"event":"fit","family":family,"barrier_net_bps":barrier}),flush=True)
            formulations.append(evaluate_formulation(family,barrier,train,cal,hold))

    passing=[r for r in formulations if r["passes_pilot_gate"]]
    result={
        "protocol":"research/t4d_btc_rare_move_jev/PROTOCOL.md",
        "feature_names":FEATURE_NAMES,
        "barriers_net_bps":BARRIER_BPS,
        "splits":{"train":dataset_summary(train),"calibration":dataset_summary(cal),"holdout":dataset_summary(hold)},
        "qa":[x.__dict__ for x in qa_train+qa_cal+qa_hold],
        "formulations":formulations,
        "decision":"GO_FULL_2023" if passing else "NO_GO_PILOT",
        "jev_status":"SHADOW_INTERFACE_ONLY_NOT_USED_FOR_SELECTION",
        "versions":{"numpy":np.__version__},
    }
    import sklearn
    result["versions"]["scikit_learn"]=sklearn.__version__

    out=Path("research/t4d_btc_rare_move_jev/results"); out.mkdir(parents=True,exist_ok=True)
    (out/"pilot.json").write_text(json.dumps(result,indent=2),encoding="utf-8")

    lines=["# T4D-BTC — rare-move quantitative gate","",f"Decision: **{result['decision']}**","",f"Train/calibration/holdout rows: {len(train.ts)} / {len(cal.ts)} / {len(hold.ts)}","","Jev is not used for candidate selection in this result; this is the pre-Jev quantitative gate.","", "| Family | Net barrier | L thr | S thr | Holdout N | Gross bps | Net8 bps | Net8 win % | Net8 PF | Bootstrap 95% CI net8 | Gate |","|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|"]
    for r in formulations:
        h=r["holdout_strategy"]; ci=r["holdout_daily_block_bootstrap_95ci_net8_bps"]
        cis="n/a" if ci is None else f"[{ci[0]:.2f}, {ci[1]:.2f}]"
        pfv="n/a" if h["net8_pf"] is None else f"{h['net8_pf']:.3f}"
        gross="n/a" if h["gross_mean_bps"] is None else f"{h['gross_mean_bps']:.3f}"
        net="n/a" if h["net8_mean_bps"] is None else f"{h['net8_mean_bps']:.3f}"
        win="n/a" if h["net8_win_rate"] is None else f"{100*h['net8_win_rate']:.2f}%"
        lines.append(f"| {r['family']} | >{r['barrier_net_bps']:.0f} bps | {r['long']['threshold']:.2f} | {r['short']['threshold']:.2f} | {h['n']} | {gross} | {net} | {win} | {pfv} | {cis} | {'PASS' if r['passes_pilot_gate'] else 'FAIL'} |")
    lines += ["","## Guardrails","","- BTCUSDT only.","- 2024 and 2025 are not loaded.","- Spread is embedded using historical executable bid/ask.","- An additional 8 bps round-trip taker fee is deducted.","- Probability thresholds are selected on August only and frozen before Sep-Dec holdout.","- Jev remains shadow-only and cannot create a candidate.",""]
    text="\n".join(lines)
    (out/"pilot.md").write_text(text,encoding="utf-8")
    print(text,flush=True)


if __name__ == "__main__":
    main()
