#!/usr/bin/env python3
from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
T4D_DIR = ROOT / "research" / "t4d_btc_rare_move_jev"
sys.path.insert(0, str(T4D_DIR))
import run as t4d  # noqa: E402

BARRIER_BPS = 8.0
THRESHOLD = 0.80
FAMILY = "hist_gradient_boosting"


def main() -> None:
    train, qa = t4d.build_dataset(t4d.TRAIN_DATES)
    if len(train.ts) == 0:
        raise RuntimeError("empty frozen training dataset")

    models = {}
    metadata = {
        "family": FAMILY,
        "barrier_net_bps": BARRIER_BPS,
        "long_threshold": THRESHOLD,
        "short_threshold": THRESHOLD,
        "feature_names": list(t4d.FEATURE_NAMES),
        "train_dates": [d.isoformat() for d in t4d.TRAIN_DATES],
        "train_rows": int(len(train.ts)),
        "qa": [q.__dict__ for q in qa],
        "seed": t4d.SEED,
    }

    for side, name in ((1, "long"), (-1, "short")):
        y = t4d.label(train, side, BARRIER_BPS)
        if len(set(int(v) for v in y)) < 2:
            raise RuntimeError(f"single-class frozen training label for {name}")
        model = t4d.make_model(FAMILY)
        model.fit(train.X, y)
        models[name] = model
        metadata[f"{name}_train_positive_rate"] = float(y.mean())
        metadata[f"{name}_train_metrics"] = t4d.binary_metrics(y, model.predict_proba(train.X)[:, 1])

    out = Path("research/t4e_btc_full_2023_confirmation/model")
    out.mkdir(parents=True, exist_ok=True)
    with (out / "frozen_hgb_barrier8.pkl").open("wb") as fh:
        pickle.dump({"models": models, "metadata": metadata}, fh, protocol=pickle.HIGHEST_PROTOCOL)
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({"event": "model_prepared", **metadata}, default=str), flush=True)


if __name__ == "__main__":
    main()
