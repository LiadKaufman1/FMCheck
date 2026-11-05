#!/usr/bin/env python3
"""Downloads an icon for every scroll in data/scrolls.json into assets/scrolls/<id>.png.

Kept in the site so the scroll picker shows icons even when maplestory.io is down.
Icons already on disk are skipped. Run after scripts/build_data.py:
  python3 scripts/fetch_icons.py
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://maplestory.io/api/GMS/83"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "scrolls")


def fetch(sid):
    path = os.path.join(OUT, f"{sid}.png")
    if os.path.exists(path):
        return True
    for i in range(5):
        try:
            req = urllib.request.Request(f"{API}/item/{sid}/icon", headers={"User-Agent": "FMCheck data builder"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return True
        except Exception as e:
            if getattr(e, "code", None) == 404:
                break
            time.sleep(2 ** (i + 1))
    print(f"no icon for {sid}", file=sys.stderr)
    return False


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(ROOT, "data", "scrolls.json")) as f:
        ids = [s["id"] for s in json.load(f)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        ok = sum(pool.map(fetch, ids))
    print(f"{ok} of {len(ids)} icons")


if __name__ == "__main__":
    main()
