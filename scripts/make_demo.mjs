// Makes src/demo.json: example posts shown on the site while it's new (tagged "Example" there).
// Mostly fairly rare items, with prices. Rarity is worked out with the site's own code (js/rarity.js);
// prices follow one rule (level, rarity, attack items worth more, never below what the scrolls cost).
//   node scripts/make_demo.mjs
import fs from "node:fs";
import { statRange } from "../js/calc.js";
import { rarity } from "../js/rarity.js";

const root = new URL("..", import.meta.url);
const equips = JSON.parse(fs.readFileSync(new URL("data/equips.json", root)));
const scrolls = JSON.parse(fs.readFileSync(new URL("data/scrolls.json", root)));
const handPrices = JSON.parse(fs.readFileSync(new URL("src/prices-seed.json", root))).prices;

let seed = 20261109;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const SELLERS = ["Kaitoru", "MiloMesos", "Lunaria", "Bramblix", "SoraBean", "Tobikage", "PeppyPig", "Nyxelle", "Grumbo",
  "Vexaria", "Pudding22", "Rokusan", "Zephyrin", "Mochiko", "Ardentia"];
const NOTES = ["Whisper me", "Open to offers", "Clean roll, check it in game", "Can trade at FM", "Price is firm", "", "", "", ""];
const SHOW_NOTES = ["Finally!", "Took me forever", "Not selling, just proud", "", ""];
const WHERE = ["Whisper me", "Henesys, ch 5", "Usually in Kerning", "Whisper me any time", "Ellinia, ch 2"];
// what to scroll, best first, per kind of item
const WANT = {
  weapon: ["PAD", "MAD"], Glove: ["PAD", "DEX", "ACC"], Hat: ["DEX", "INT", "MHP", "ACC"], Top: ["STR", "DEX", "INT", "LUK", "PDD"],
  Overall: ["DEX", "INT", "LUK", "STR", "PDD"], Bottom: ["DEX", "Jump", "PDD"], Shoes: ["Speed", "Jump", "DEX", "EVA"],
  Earring: ["INT", "DEX", "LUK"], Cape: ["STR", "INT", "DEX", "LUK", "MDD"], Shield: ["STR", "LUK", "INT", "PDD"],
};
// what the examples are: mostly weapons and Work Gloves, some clothes, a few other things
const PLAN = [["weapon", 24], ["work", 10], ["Glove", 3], ["clothes", 9], ["other", 3]];
const OK_TIERS = ["Uncommon", "Rare", "Epic", "Legendary"];

const kind = (e) => (Math.floor(e[0] / 10000) >= 130 ? "weapon" : e[3]);
const group = (e) => (e[0] === 1082000 ? "work" : ["Top", "Bottom", "Overall"].includes(e[3]) ? "clothes"
  : ["weapon", "Glove"].includes(kind(e)) ? kind(e) : "other");
function family(e) {
  const mine = scrolls.filter((s) => s.target === Math.floor(e[0] / 10000));
  for (const stat of WANT[kind(e)] || []) {
    const fam = Object.fromEntries(mine.filter((s) => stat in s.stats).map((s) => [s.tier, s]));
    if (fam.Lesser && fam.Intermediate) return { stat, fam };
  }
  return null;
}
const nice = (n) => { const d = 10 ** Math.max(0, String(Math.round(n)).length - 2); return Math.round(n / d) * d; };
const byId = (id) => scrolls.find((s) => s.id === id);

// prices kept modest: gloves by the attack they gained, the rest by level and rarity; never below the scrolls' cost
function priceOf(e, g, r, rows, stat) {
  const cost = rows.reduce((a, x) => a + x.n * (handPrices[x.id] || 0), 0);
  const lvl = 2 ** ((e[2] - 10) / 12), wobble = 0.85 + rnd() * 0.3;
  let p;
  if (kind(e) === "Glove" && stat === "PAD") {
    const gain = rows.reduce((a, x) => a + x.n * (byId(x.id).stats.PAD || 0), 0);
    p = 1e6 * 1.4 ** gain * wobble;
  } else if (g === "weapon") p = 200e3 * lvl * r.oneIn ** 0.35 * wobble;
  else p = 100e3 * lvl * r.oneIn ** 0.3 * wobble;
  return nice(Math.min(g === "weapon" || g === "work" ? 200e6 : 60e6, Math.max(p, cost * 1.15)));
}

const out = [];
for (const [g, count] of PLAN) {
  const pool = equips.filter((e) => group(e) === g && e[2] >= 10 && e[2] <= 70 && e[4] >= 5 && family(e));
  const usedItems = new Set();
  let made = 0;
  for (let tries = 0; tries < 200000 && made < count; tries++) {
    const e = pick(pool);
    if (g !== "work" && usedItems.has(e[0])) continue;
    const { stat, fam } = family(e);
    const clean = {};
    for (const [k, v] of Object.entries(e[5])) {
      const [, hi] = statRange(k, v);
      clean[k] = rnd() < 0.35 ? hi : between(v, hi);
    }
    const slots = e[4];
    const left = pick([0, 0, 0, 1, 1, 2]);
    const used = slots - left;
    const rows = [];
    let budget = used - between(0, Math.min(2, used - 1));
    const big = rnd() < 0.3 ? pick(["Greater", "Chaos"]) : null;
    if (big && fam[big] && budget > 0) { rows.push({ id: fam[big].id, n: 1 }); budget--; }
    const inter = between(Math.ceil(budget / 2), budget);
    if (inter) rows.push({ id: fam.Intermediate.id, n: inter });
    if (budget - inter > 0) rows.push({ id: fam.Lesser.id, n: budget - inter });
    if (!rows.length) continue;
    const r = rarity({ base: e[5], clean, used, rows: rows.map((x) => ({ successes: x.n, success: byId(x.id).success, boom: byId(x.id).boom })) });
    const tier = r.tier.name;
    if (!OK_TIERS.includes(tier) || (tier === "Legendary" && rnd() < 0.6)) continue;
    usedItems.add(e[0]);
    made++;
    const i = out.length;
    out.push({
      item: e[0], clean, left, scrolls: rows,
      price: priceOf(e, g, r, rows, stat), estimate: null,
      channel: rnd() < 0.75 ? between(1, 20) : null, room: rnd() < 0.75 ? between(1, 22) : null,
      where: rnd() < 0.25 ? pick(WHERE) : null,
      note: pick(NOTES) || null,
      seller: SELLERS[i % SELLERS.length], supporter: false, verified: false, featured: false,
      minutesAgo: between(3, 60 * 60), seenAgo: between(1, 180),
      _tier: tier, _oneIn: Math.round(r.oneIn), _g: g,
    });
  }
}
// mixed order, so the newest aren't all weapons
out.sort(() => rnd() - 0.5);
fs.writeFileSync(new URL("src/demo.json", root), JSON.stringify(out.map(({ _tier, _oneIn, _g, ...x }) => x)));
const fm = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}m` : `${n / 1e3}k`);
console.log(out.length, "examples");
for (const x of out.slice().sort((a, b) => a._g.localeCompare(b._g))) { const e = equips.find((q) => q[0] === x.item); console.log(` ${x._g.padEnd(7)} ${e[1]} (L${e[2]}) ${x._tier} 1 in ${x._oneIn} -> ${fm(x.price)}`); }
