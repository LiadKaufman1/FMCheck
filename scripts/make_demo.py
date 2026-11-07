#!/usr/bin/env python3
"""Makes src/demo.json: example items shown on the community page while it's new.

They're marked "Example" on the site, rank below real items, and stop showing once enough real items are up
(see src/community.js). Stats, slots and scrolls are legal for each item; the server works out the odds.
  python3 scripts/make_demo.py
"""
import json
import math
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
equips = json.load(open(os.path.join(ROOT, "data", "equips.json")))
scrolls = json.load(open(os.path.join(ROOT, "data", "scrolls.json")))
rng = random.Random(20261107)

SELLERS = [  # name, supporter
    ("Kaitoru", True), ("MiloMesos", False), ("Lunaria", True), ("Bramblix", False), ("SoraBean", False),
    ("Tobikage", True), ("PeppyPig", False), ("Nyxelle", False), ("Grumbo", False), ("Vexaria", True),
    ("Pudding22", False), ("Rokusan", False), ("Zephyrin", False), ("Mochiko", True), ("Ardentia", False),
]
NOTES = ["Whisper me", "Open to offers", "Clean roll, check it in game", "Can trade at FM", "Price is firm",
         "Will be on tonight", "Trading for mesos only", "", "", "", "", ""]
# scroll stat to look for, best first, per kind of item
WANT = {
    "weapon": ["PAD", "MAD"], "Glove": ["PAD", "DEX", "ACC"], "Hat": ["DEX", "INT", "MHP", "ACC"],
    "Top": ["STR", "DEX", "INT", "LUK", "PDD"], "Overall": ["DEX", "INT", "LUK", "STR", "PDD"], "Bottom": ["DEX", "Jump", "PDD"],
    "Shoes": ["Speed", "Jump", "DEX", "EVA"], "Earring": ["INT", "DEX", "LUK"], "Cape": ["STR", "INT", "DEX", "LUK", "MDD"],
    "Shield": ["STR", "LUK", "INT", "PDD"],
}
PER_CAT = {"weapon": 13, "Glove": 6, "Hat": 5, "Top": 3, "Overall": 4, "Bottom": 2, "Shoes": 4, "Earring": 4, "Cape": 2, "Shield": 2}


def kind(e):
    return "weapon" if e[0] // 10000 >= 130 else e[3]


def stat_range(key, base):
    r = min(math.ceil(base * 0.1), 10 if key in ("PDD", "MDD", "MHP", "MMP") else 5)
    return max(0, base - r), base + r


def family_scrolls(e):
    target = e[0] // 10000
    mine = [s for s in scrolls if s["target"] == target]
    for stat in WANT[kind(e)]:
        fam = [s for s in mine if stat in s["stats"]]
        tiers = {s["tier"]: s for s in fam}
        if "Lesser" in tiers and "Intermediate" in tiers:
            return tiers
    return None


def nice(n):
    if n <= 0:
        return 0
    d = 10 ** (len(str(int(n))) - 2)
    return int(round(n / d) * d)


items = []
for k, n in PER_CAT.items():
    pool = [e for e in equips if kind(e) == k and 10 <= e[2] <= 70 and e[4] >= 5 and family_scrolls(e)]
    rng.shuffle(pool)
    items += pool[:n]
rng.shuffle(items)

out = []
for i, e in enumerate(items):
    tiers = family_scrolls(e)
    slots = e[4]
    base = e[5]
    clean = {}
    for key, v in base.items():
        lo, hi = stat_range(key, v)
        clean[key] = rng.randint(max(lo, v - 1), hi)  # most sellers list a decent roll
    left = rng.choice([0, 0, 0, 1, 1, 2, 3]) if slots > 3 else 0
    used = slots - left
    inter = rng.randint(1, used) if rng.random() < 0.8 else 0  # Intermediate (60%) passes make an item rarer
    lesser = rng.randint(0, used - inter) if used - inter > 0 else 0
    if inter + lesser == 0:
        lesser = 1
    sc = []
    if inter:
        sc.append({"id": tiers["Intermediate"]["id"], "n": inter})
    if lesser:
        sc.append({"id": tiers["Lesser"]["id"], "n": lesser})
    pts = inter * 2 + lesser  # scroll passes, Intermediate counting double
    lvl = e[2]
    attack = any(s in tiers["Lesser"]["stats"] for s in ("PAD", "MAD"))
    price = lvl * lvl * 900 * (1 + (pts ** 1.6) * (0.8 if attack else 0.12)) * (1 + 0.25 * inter) * rng.uniform(0.75, 1.25)
    seller, supporter = SELLERS[i % len(SELLERS)]
    show = False  # every example is for sale (no showcase)
    est = None
    if not show and rng.random() < 0.5:
        est = {"lo": nice(price * rng.uniform(0.8, 0.95)), "hi": nice(price * rng.uniform(1.0, 1.2))}
    out.append({
        "item": e[0], "clean": clean, "left": left, "scrolls": sc,
        "price": None if show else max(10000, nice(price)), "estimate": est,
        "channel": rng.randint(1, 20), "room": rng.randint(1, 22), "note": rng.choice(NOTES) or None,
        "seller": seller, "supporter": supporter,
        "verified": rng.random() < 0.35, "featured": False,
        "minutesAgo": rng.randint(3, 60 * 60),  # posted up to 2.5 days ago
        "seenAgo": rng.randint(1, 180),
    })

# a few Featured, all from supporters: their most scrolled items
sup = sorted((o for o in out if o["supporter"] and o["price"]), key=lambda o: -sum(x["n"] for x in o["scrolls"] if x["id"] % 2))
for o in sup[:4]:
    o["featured"] = True
    o["verified"] = True

json.dump(out, open(os.path.join(ROOT, "src", "demo.json"), "w"), indent=0)
print(len(out), "example items,", sum(o["supporter"] for o in out), "from supporters,", sum(o["featured"] for o in out), "featured,",
      sum(o["price"] is None for o in out), "showcase")
