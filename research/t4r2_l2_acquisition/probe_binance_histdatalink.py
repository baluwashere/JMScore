#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://api.binance.com"
ENDPOINT = "/sapi/v1/futures/histDataLink"


def ms(day: str, end: bool = False) -> int:
    dt = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    if end:
        return int((dt.timestamp() + 86399.999) * 1000)
    return int(dt.timestamp() * 1000)


def signed_request(api_key: str, secret: str, symbol: str, data_type: str, day: str) -> dict:
    params = {
        "symbol": symbol,
        "dataType": data_type,
        "startTime": ms(day),
        "endTime": ms(day, True),
        "recvWindow": 5000,
        "timestamp": int(time.time() * 1000),
    }
    query = urllib.parse.urlencode(params)
    sig = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
    url = f"{BASE}{ENDPOINT}?{query}&signature={sig}"
    req = urllib.request.Request(url, headers={"X-MBX-APIKEY": api_key, "User-Agent": "JMScore-T4R2/1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8", errors="replace")
            payload = json.loads(body)
            return {"http_status": r.status, "payload": payload}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"message": raw[:1000]}
        return {"http_status": exc.code, "payload": payload}


def sanitize(result: dict, data_type: str) -> dict:
    payload = result.get("payload") or {}
    rows = payload.get("data") if isinstance(payload, dict) else None
    out = {
        "data_type": data_type,
        "http_status": result.get("http_status"),
        "entry_count": len(rows) if isinstance(rows, list) else 0,
        "days": [],
        "error_code": payload.get("code") if isinstance(payload, dict) else None,
        "error_message": payload.get("msg") if isinstance(payload, dict) else None,
    }
    if isinstance(rows, list):
        for row in rows:
            raw_url = row.get("url", "") if isinstance(row, dict) else ""
            parsed = urllib.parse.urlparse(raw_url) if raw_url else None
            out["days"].append({
                "day": row.get("day") if isinstance(row, dict) else None,
                "has_url": bool(raw_url),
                "url_host": parsed.hostname if parsed else None,
                "url_path_basename": Path(parsed.path).name if parsed else None,
            })
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--day", default="2023-09-15")
    p.add_argument("--symbol", default="BTCUSDT")
    p.add_argument("--out", default="research/t4r2_l2_acquisition/results/binance_probe.json")
    args = p.parse_args()

    api_key = os.environ.get("BINANCE_API_KEY")
    secret = os.environ.get("BINANCE_API_SECRET")
    if not api_key or not secret:
        raise SystemExit("BINANCE_API_KEY and BINANCE_API_SECRET are required via environment/secret storage")

    results = []
    for data_type in ("T_DEPTH", "S_DEPTH"):
        results.append(sanitize(signed_request(api_key, secret, args.symbol, data_type, args.day), data_type))

    decision = "BINANCE_NATIVE_L2_UNAVAILABLE"
    counts = {x["data_type"]: x["entry_count"] for x in results}
    if counts.get("T_DEPTH", 0) > 0 and counts.get("S_DEPTH", 0) > 0:
        decision = "BINANCE_NATIVE_L2_LINKS_AVAILABLE"
    elif counts.get("T_DEPTH", 0) > 0 or counts.get("S_DEPTH", 0) > 0:
        decision = "BINANCE_NATIVE_L2_PARTIAL"

    out = {"symbol": args.symbol, "day": args.day, "decision": decision, "results": results}
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
