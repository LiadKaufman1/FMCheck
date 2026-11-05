#!/usr/bin/env python3
"""Downloads the icon of every item and scroll in data/*.json into assets/items/<8-digit id>.png.

The site serves these itself, so it doesn't load images from osmsdataexplorer.com on every visit
(less load on them, and the icons keep working if their site is down).
Icons already on disk are skipped. Run after scripts/build_data.py:
  python3 scripts/fetch_icons.py
Icons: OSMS Data Explorer (https://osmsdataexplorer.com); game art © Nexon.
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://osmsdataexplorer.com/data/current/images/items"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "items")


def fetch(item_id):
    name = f"{item_id:08d}.png"
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        return True
    for i in range(4):
        try:
            req = urllib.request.Request(f"{BASE}/{name}", headers={"User-Agent": "FMCheck data builder"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if not data.startswith(b"\x89PNG"):
                break
            with open(path, "wb") as f:
                f.write(data)
            return True
        except Exception as e:
            if getattr(e, "code", None) == 404:
                break
            time.sleep(2 ** (i + 1))
    print(f"no icon for {item_id}", file=sys.stderr)
    return False


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(ROOT, "data", "equips.json")) as f:
        ids = [e[0] for e in json.load(f)]
    with open(os.path.join(ROOT, "data", "scrolls.json")) as f:
        ids += [s["id"] for s in json.load(f)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        ok = sum(pool.map(fetch, ids))
    print(f"{ok} of {len(ids)} icons")


if __name__ == "__main__":
    main()
