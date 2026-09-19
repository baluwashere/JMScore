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
from array import array
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations, product
from pathlib import Path

SYMBOL = "BTCUSDT"
BASE_URL = "https://data.binance.vision/data/futures/um/monthly/klines"
USER_AGENT = "JMScore-research/0.1"
ENTRY_COST_BPS = 10.0
H1_END_MS = int(datetime(2023, 7, 1, tzinfo=timezone.utc).timestamp() * 1000)
YEAR_END_MS = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
BOOTSTRAP_SEED = 20230919
BOOTSTRAP_DRAWS = 2000

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
    def empty(cls):
        return cls(array("q"), array("d"), array("d"), array("d"), array("d"), array("d"), array("d"))

    def __len__(self):
        return len(self.ts)

@dataclass
class Signal:
    i: int
    ts: int
    side: int
    gross5: float
    momentum_strength: float
    imbalance_strength: float
    volume_z20: float
    persistence_5: int


def request_bytes(url: str, attempts: int = 4) -> bytes:
    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"download failed: {url}: {last}")


def normalize_ts(value: str) -> int:
    ts = int(value)
    if ts > 100_000_000_000_000:
        ts //= 1000
    return ts


def load_2023() -> Series:
    s = Series.empty()
    for month in range(1, 13):
        name = f"{SYMBOL}-1m-2023-{month:02d}.zip"
        url = f"{BASE_URL}/{SYMBOL}/1m/{name}"
        print(json.dumps({"event":"download","month":month}), flush=True)
        blob = request_bytes(url)
        expected = request_bytes(url + ".CHECKSUM").decode().split()[0].lower()
        actual = hashlib.sha256(blob).hexdigest().lower()
        if expected != actual:
            raise RuntimeError(f"checksum mismatch {name}")
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            csv_names = [n for n in zf.namelist() if n.endswith('.csv')]
            if len(csv_names) != 1:
                raise RuntimeError(f"unexpected archive contents {name}: {csv_names}")
            with zf.open(csv_names[0]) as raw:
                reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8', newline=''))
                count = 0
                for row in reader:
                    if not row:
                        continue
                    try:
                        ts = normalize_ts(row[0])
                    except (ValueError, IndexError):
                        continue
                    s.ts.append(ts)
                    s.open.append(float(row[1])); s.high.append(float(row[2])); s.low.append(float(row[3])); s.close.append(float(row[4]))
                    s.volume.append(float(row[5])); s.taker_buy.append(float(row[9])); count += 1
        print(json.dumps({"event":"loaded","month":month,"rows":count}), flush=True)
    return s


def qa(s: Series) -> dict:
    gaps = duplicates = backwards = irregular = 0
    for i in range(1, len(s)):
        d = s.ts[i] - s.ts[i-1]
        if d == 0: duplicates += 1
        elif d < 0: backwards += 1
        elif d > 60000: gaps += 1
        elif d != 60000: irregular += 1
    return {"rows":len(s),"gaps_gt_1m":gaps,"duplicates":duplicates,"backwards":backwards,"irregular_subminute_deltas":irregular}


def stdpop(vals: list[float]) -> float:
    if not vals: return 0.0
    m = statistics.fmean(vals)
    return math.sqrt(sum((x-m)*(x-m) for x in vals)/len(vals))


def quantile(vals: list[float], q: float) -> float:
    xs = sorted(vals)
    if not xs: return math.nan
    pos = (len(xs)-1)*q
    lo = int(math.floor(pos)); hi = int(math.ceil(pos))
    if lo == hi: return xs[lo]
    w = pos-lo
    return xs[lo]*(1-w)+xs[hi]*w


def build_signals(s: Series) -> list[Signal]:
    out: list[Signal] = []
    one_min_returns = [0.0] * len(s)
    for i in range(1, len(s)):
        one_min_returns[i] = s.close[i] / s.close[i-1] - 1.0

    for i in range(25, len(s)-7):
        if s.ts[i] >= YEAR_END_MS:
            break
        if s.ts[i] - s.ts[i-25] != 25*60000 or s.ts[i+6]-s.ts[i] != 6*60000:
            continue
        r1 = one_min_returns[i]
        r5 = s.close[i]/s.close[i-5]-1.0
        vol = s.volume[i]
        if vol <= 0: continue
        imb = (2*s.taker_buy[i]-vol)/vol
        side = 1 if (r1>0 and r5>0 and imb>0) else -1 if (r1<0 and r5<0 and imb<0) else 0
        if side == 0: continue

        rv15 = math.sqrt(sum(r*r for r in one_min_returns[i-14:i+1]))
        if rv15 <= 0: continue
        momentum_strength = abs(r5)/rv15

        prev_volumes = list(s.volume[i-20:i])
        vmean = statistics.fmean(prev_volumes)
        vstd = stdpop(prev_volumes)
        if vstd <= 0:
            continue
        volume_z20 = (vol-vmean)/vstd
        persistence = sum(1 for r in one_min_returns[i-4:i+1] if side*r > 0)

        entry = s.open[i+1]
        exit5 = s.open[i+6]
        gross5 = side*(exit5/entry-1.0)
        out.append(Signal(i,s.ts[i],side,gross5,momentum_strength,abs(imb),volume_z20,persistence))
    return out


def nonoverlap(signals: list[Signal]) -> list[Signal]:
    selected=[]; next_i=-1
    for x in signals:
        if x.i < next_i: continue
        selected.append(x); next_i=x.i+6
    return selected


def pf(vals: list[float]) -> float | None:
    g=sum(v for v in vals if v>0); l=-sum(v for v in vals if v<0)
    if l==0: return None if g==0 else math.inf
    return g/l


def metric(xs: list[Signal]) -> dict:
    vals=[x.gross5 for x in xs]
    if not vals:
        return {"n":0,"gross_mean_bps":None,"net10_mean_bps":None,"gross_win_rate":None,"net10_pf":None}
    net=[v-ENTRY_COST_BPS/10000 for v in vals]
    return {
        "n":len(vals),
        "gross_mean_bps":statistics.fmean(vals)*10000,
        "net10_mean_bps":statistics.fmean(net)*10000,
        "gross_win_rate":sum(v>0 for v in vals)/len(vals),
        "net10_pf":pf(net),
    }


def day_key(ts:int) -> int:
    return ts // 86_400_000


def bootstrap_ci(xs:list[Signal]) -> list[float] | None:
    if not xs: return None
    groups: dict[int,list[float]]={}
    for x in xs: groups.setdefault(day_key(x.ts),[]).append(x.gross5)
    days=list(groups)
    if len(days)<2: return None
    rng=random.Random(BOOTSTRAP_SEED)
    means=[]
    for _ in range(BOOTSTRAP_DRAWS):
        vals=[]
        for _ in days:
            vals.extend(groups[rng.choice(days)])
        means.append(statistics.fmean(vals)*10000)
    means.sort()
    return [means[int(.025*(len(means)-1))], means[int(.975*(len(means)-1))]]


def rule_passes(x:Signal, rule:dict) -> bool:
    scope=rule['scope']
    if scope=='LONG_ONLY' and x.side!=1: return False
    if scope=='SHORT_ONLY' and x.side!=-1: return False
    f=rule['filters']
    if 'momentum_strength' in f and x.momentum_strength < f['momentum_strength']: return False
    if 'imbalance_strength' in f and x.imbalance_strength < f['imbalance_strength']: return False
    if 'volume_z20' in f and x.volume_z20 < f['volume_z20']: return False
    if 'persistence_5' in f and x.persistence_5 < f['persistence_5']: return False
    return True


def make_rules(h1:list[Signal]) -> tuple[list[dict],dict]:
    thresholds={
        'momentum_strength': {f'q{int(q*100)}':quantile([x.momentum_strength for x in h1],q) for q in (.5,.75,.9)},
        'imbalance_strength': {f'q{int(q*100)}':quantile([x.imbalance_strength for x in h1],q) for q in (.5,.75,.9)},
        'volume_z20': {'z0':0.0,'z1':1.0,'z2':2.0},
        'persistence_5': {'p3':3,'p4':4,'p5':5},
    }
    families=list(thresholds)
    rules=[]
    scopes=['BOTH','LONG_ONLY','SHORT_ONLY']
    for size in (1,2):
        for fams in combinations(families,size):
            choices=[list(thresholds[f].items()) for f in fams]
            for picked in product(*choices):
                filters={f:float(v) for f,(_,v) in zip(fams,picked)}
                labels={f:lab for f,(lab,_) in zip(fams,picked)}
                for scope in scopes:
                    rid=scope+'|'+'+'.join(f'{f}:{labels[f]}' for f in fams)
                    rules.append({'id':rid,'scope':scope,'filters':filters,'labels':labels})
    return rules,thresholds


def main():
    s=load_2023(); quality=qa(s)
    if any(quality[k] for k in ('gaps_gt_1m','duplicates','backwards','irregular_subminute_deltas')):
        raise RuntimeError(f'data QA failed: {quality}')
    signals=build_signals(s)
    h1=[x for x in signals if x.ts < H1_END_MS]
    h2=[x for x in signals if x.ts >= H1_END_MS]
    rules,thresholds=make_rules(h1)

    discovery=[]
    for r in rules:
        xs=nonoverlap([x for x in h1 if rule_passes(x,r)])
        m=metric(xs)
        if m['n']>=500:
            discovery.append({'rule':r,'metric':m})
    discovery.sort(key=lambda z:z['metric']['gross_mean_bps'], reverse=True)
    top=discovery[:10]

    confirmed=[]
    evaluated=[]
    for item in top:
        r=item['rule']
        xs=nonoverlap([x for x in h2 if rule_passes(x,r)])
        m=metric(xs); ci=bootstrap_ci(xs)
        pass_gate=(m['n']>=300 and m['gross_mean_bps'] is not None and m['gross_mean_bps']>10 and m['net10_mean_bps']>0 and (m['net10_pf'] or 0)>1 and item['metric']['gross_mean_bps']*m['gross_mean_bps']>0)
        row={'rule':r,'h1':item['metric'],'h2':m,'h2_daily_block_bootstrap_95ci_gross_bps':ci,'passes_gate':pass_gate}
        evaluated.append(row)
        if pass_gate: confirmed.append(row)

    result={
        'protocol':'research/momentum_v1_2023/PROTOCOL.md',
        'data_qa':quality,
        'base_signal_counts':{'h1':len(h1),'h2':len(h2)},
        'thresholds_learned_h1':thresholds,
        'candidate_rules_total':len(rules),
        'candidate_rules_h1_eligible':len(discovery),
        'top10_discovery_and_h2':evaluated,
        'confirmed_rules':confirmed,
        'decision':'GO' if confirmed else 'NO-GO',
    }
    out=Path('research/momentum_v1_2023/results'); out.mkdir(parents=True, exist_ok=True)
    (out/'conditional_2023.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

    lines=['# Conditional momentum v1 — 2023','',f"Decision: **{result['decision']}**",'',f"Base signals H1/H2: {len(h1)} / {len(h2)}",f"Rules searched: {len(rules)}; H1 eligible (>=500 non-overlapping): {len(discovery)}",'', '| Rank | Rule | H1 N | H1 gross bps | H2 N | H2 gross bps | H2 net10 bps | H2 PF | H2 bootstrap 95% CI | Gate |','|---:|---|---:|---:|---:|---:|---:|---:|---|---|']
    for rank,row in enumerate(evaluated,1):
        h1m=row['h1']; h2m=row['h2']; ci=row['h2_daily_block_bootstrap_95ci_gross_bps']
        cis='n/a' if ci is None else f"[{ci[0]:.2f}, {ci[1]:.2f}]"
        lines.append(f"| {rank} | `{row['rule']['id']}` | {h1m['n']} | {h1m['gross_mean_bps']:.3f} | {h2m['n']} | {h2m['gross_mean_bps']:.3f} | {h2m['net10_mean_bps']:.3f} | {h2m['net10_pf']:.3f} | {cis} | {'PASS' if row['passes_gate'] else 'FAIL'} |")
    lines += ['', '## Guardrails', '', '- 2024 and 2025 are not loaded by this experiment.', '- H1 thresholds are frozen before H2 evaluation.', '- Only one- or two-family rules from the preregistered protocol are searched.', '- Primary results use non-overlapping five-minute positions.', '- A rule must exceed 10 bps gross in H2 and remain profitable after 10 bps round-trip cost.', '']
    (out/'conditional_2023.md').write_text('\n'.join(lines),encoding='utf-8')
    print('\n'.join(lines), flush=True)

if __name__=='__main__':
    main()
