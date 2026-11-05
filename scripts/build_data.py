#!/usr/bin/env python3
"""Builds the static data files the site reads, from the MapleStory Classic World client data.

Source: OSMS Data Explorer public dataset, https://osmsdataexplorer.com (CC BY 4.0, credit @ohmi).
Docs: https://osmsdataexplorer.com/data/api/v1/README.md

  data/equips.json   equips that take scrolls: [id, name, reqLevel, type, slots, {stat: base}]
  data/scrolls.json  scrolls: id, name, tier, success %, boom %, stat gains, target item prefix
  data/source.json   which client build and dataset date the files came from

Run: python3 scripts/build_data.py
"""
import json
import os
import urllib.request

API = "https://osmsdataexplorer.com/data/api/v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")

# WZ stat keys -> the site's stat keys. Scrolls write weapon attack as incWAT.
STAT_KEYS = {"incSTR": "STR", "incDEX": "DEX", "incINT": "INT", "incLUK": "LUK",
             "incPAD": "PAD", "incWAT": "PAD", "incMAD": "MAD", "incPDD": "PDD", "incMDD": "MDD",
             "incACC": "ACC", "incEVA": "EVA", "incMHP": "MHP", "incMMP": "MMP",
             "incSpeed": "Speed", "incJump": "Jump", "incCRT": "CRT", "incCRD": "CRD"}
TIER_ORDER = {"Lesser": 0, "Intermediate": 1, "Greater": 2, "Chaos": 3}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "FMCheck data builder"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def stats_of(raw):
    out = {}
    for k, v in (raw or {}).items():
        try:
            v = int(v)  # a few values come as strings, e.g. "26"
        except (TypeError, ValueError):
            continue
        if k in STAT_KEYS and v:
            out[STAT_KEYS[k]] = out.get(STAT_KEYS[k], 0) + v
    return out


def scroll_target(sid):
    """Scroll 204ABxx upgrades items whose id starts with 1AB (2040803 -> 108xxxx gloves)."""
    return 100 + (sid // 100 - 20400)


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = get_json(f"{API}/meta.json")
    items = get_json(f"{API}/items.json")

    equips = []
    for it in items:
        st = it.get("stats") or {}
        if it.get("category") != "Equipment" or not st.get("tuc"):
            continue
        kind = (it.get("weapon") or {}).get("type") or it.get("sub_category") or ""
        equips.append([it["id"], it["name"].strip(), st.get("reqLevel", 0), kind, st["tuc"], stats_of(st)])
    equips.sort(key=lambda e: (e[1].lower(), e[0]))

    prefixes = {e[0] // 10000 for e in equips}
    scrolls = []
    for it in items:
        sc = it.get("scroll")
        if not sc or scroll_target(it["id"]) not in prefixes:
            continue  # e.g. pet equip scrolls
        gains = stats_of(sc.get("stats"))
        if not gains or not sc.get("success_rate"):
            continue
        scrolls.append({"id": it["id"], "name": it["name"].strip(), "tier": sc.get("tier", ""),
                        "success": sc["success_rate"], "boom": sc.get("destroy_rate", 0),
                        "target": scroll_target(it["id"]), "stats": gains})
    scrolls.sort(key=lambda s: (s["target"], s["name"].split(":")[0], TIER_ORDER.get(s["tier"], 9)))

    def dump(name, obj):
        with open(os.path.join(OUT, name), "w") as f:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)

    dump("equips.json", equips)
    dump("scrolls.json", scrolls)
    dump("source.json", {"client_build": meta.get("client_build"), "data_updated_at": meta.get("data_updated_at")})
    print(f"{len(equips)} equips, {len(scrolls)} scrolls (client data from {meta.get('data_updated_at')})")


if __name__ == "__main__":
    main()
