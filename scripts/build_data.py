#!/usr/bin/env python3
"""Builds the static data files the site reads.

Source: maplestory.io (GMS v83 data, the closest public match to MapleStory Classic).

  data/equips.json   every non-cash equip that takes scrolls: [id, name, reqLevel, category, slots, {stat: base}]
  data/scrolls.json  every regular/dark scroll: id, name, success %, boom %, stat gains, target item prefix

Stats are stored here so the page doesn't depend on maplestory.io being up.

Run: python3 scripts/build_data.py
"""
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://maplestory.io/api/GMS/83"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")

# Equip id prefixes (id // 10000) that take scrolls: armor/accessories 100-113, weapons 130-149.
EQUIP_PREFIXES = set(range(100, 114)) | set(range(130, 150))

STAT_KEYS = ["incSTR", "incDEX", "incINT", "incLUK", "incPAD", "incMAD", "incPDD", "incMDD",
             "incACC", "incEVA", "incMHP", "incMMP", "incSpeed", "incJump"]


def get_json(url, tries=4):  # retries with backoff: 2s, 4s, 8s...
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "FMCheck data builder"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # network hiccup: back off and retry
            if i == tries - 1:
                raise
            print(f"retry {url}: {e}", file=sys.stderr)
            time.sleep(2 ** (i + 1))


def item_meta(item_id):
    try:
        return get_json(f"{API}/item/{item_id}", tries=6).get("metaInfo", {})
    except Exception as e:
        print(f"skip {item_id}: {e}", file=sys.stderr)
        return None


def build_equips(items):
    out = []
    for it in items:
        ti = it.get("typeInfo", {})
        if ti.get("overallCategory") != "Equip" or it.get("isCash"):
            continue
        if it["id"] // 10000 not in EQUIP_PREFIXES:
            continue
        name = (it.get("name") or "").strip()
        if not name:
            continue
        out.append([it["id"], name, it.get("requiredLevel", 0), ti.get("subCategory") or ti.get("category") or ""])
    with ThreadPoolExecutor(max_workers=4) as pool:
        metas = list(pool.map(lambda e: item_meta(e[0]), out))
    missing = sum(m is None for m in metas)
    if missing:
        raise SystemExit(f"{missing} items failed to load; maplestory.io may be down. Try again later.")
    full = []
    for e, m in zip(out, metas):
        if not m.get("tuc"):
            continue  # no upgrade slots: nothing to scroll
        stats = {k[3:]: m[k] for k in STAT_KEYS if m.get(k)}
        full.append(e + [m["tuc"], stats])
    full.sort(key=lambda x: (x[1].lower(), x[0]))
    return full


def scroll_target(sid):
    """Scroll 204ABxx upgrades items whose id starts with 1AB (e.g. 2043001 -> 130xxxx one-handed swords)."""
    return 100 + (sid // 100 - 20400)


def is_regular_scroll(name):
    n = name.lower()
    return (n.startswith("scroll for") or n.startswith("dark scroll for")) and "[" not in n


def build_scrolls(items):
    cands = [it for it in items
             if 2040000 <= it["id"] < 2049000 and is_regular_scroll(it.get("name") or "")
             and scroll_target(it["id"]) in EQUIP_PREFIXES]

    def meta(it):
        try:
            return it, get_json(f"{API}/item/{it['id']}", tries=6).get("metaInfo", {})
        except Exception as e:
            print(f"skip {it['id']}: {e}", file=sys.stderr)
            return it, None

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(meta, cands))

    out, seen = [], set()
    for it, m in results:
        if not m or not m.get("success"):
            continue
        stats = {k[3:]: m[k] for k in STAT_KEYS if m.get(k)}
        if not stats:
            continue
        success = int(m["success"])
        boom = int(m.get("cursed", 0))
        # Names in v83 often omit the %, so add it for the picker.
        name = re.sub(r"\s+\d+%$", "", it["name"].strip())
        name = f"{name} {success}%"
        key = (name, scroll_target(it["id"]), tuple(sorted(stats.items())), boom)
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": it["id"], "name": name, "success": success, "boom": boom,
                    "target": scroll_target(it["id"]), "stats": stats})
    out.sort(key=lambda s: (s["target"], s["name"]))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    print("fetching item list...")
    items = get_json(f"{API}/item")
    equips = build_equips(items)
    print(f"{len(equips)} equips")
    scrolls = build_scrolls(items)
    print(f"{len(scrolls)} scrolls")
    with open(os.path.join(OUT, "equips.json"), "w") as f:
        json.dump(equips, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(OUT, "scrolls.json"), "w") as f:
        json.dump(scrolls, f, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
