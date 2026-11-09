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
// how many of each tier we want (rare ones mostly)
const WANTED = { Uncommon: 6, Rare: 17, Epic: 15, Legendary: 7 };

const kind = (e) => (Math.floor(e[0] / 10000) >= 130 ? "weapon" : e[3]);
function family(e) {
  const mine = scrolls.filter((s) => s.target === Math.floor(e[0] / 10000));
  for (const stat of WANT[kind(e)] || []) {
    const fam = Object.fromEntries(mine.filter((s) => stat in s.stats).map((s) => [s.tier, s]));
    if (fam.Lesser && fam.Intermediate) return { stat, fam };
  }
  return null;
}
const nice = (n) => { const d = 10 ** Math.max(0, String(Math.round(n)).length - 2); return Math.round(n / d) * d; };

const pool = equips.filter((e) => e[2] >= 10 && e[2] <= 70 && e[4] >= 5 && family(e));
const got = Object.fromEntries(Object.keys(WANTED).map((t) => [t, 0]));
const out = [];
const usedItems = new Set();
for (let tries = 0; tries < 200000 && out.length < 45; tries++) {
  const e = pick(pool);
  if (usedItems.has(e[0])) continue;
  const { stat, fam } = family(e);
  // clean roll: often a high one
  const clean = {};
  for (const [k, v] of Object.entries(e[5])) {
    const [, hi] = statRange(k, v);
    clean[k] = rnd() < 0.35 ? hi : between(v, hi);
  }
  const slots = e[4];
  const left = pick([0, 0, 0, 1, 1, 2]);
  const used = slots - left;
  // passes: mostly Intermediate, sometimes a Greater or Chaos, the rest Lesser; some failures
  const rows = [];
  let budget = used - between(0, Math.min(2, used - 1));
  const big = rnd() < 0.35 ? pick(["Greater", "Chaos"]) : null;
  if (big && fam[big] && budget > 0) { rows.push({ id: fam[big].id, n: 1 }); budget--; }
  const inter = between(Math.ceil(budget / 2), budget);
  if (inter) rows.push({ id: fam.Intermediate.id, n: inter });
  if (budget - inter > 0) rows.push({ id: fam.Lesser.id, n: budget - inter });
  if (!rows.length) continue;
  const byId = (id) => scrolls.find((s) => s.id === id);
  const r = rarity({ base: e[5], clean, used, rows: rows.map((x) => ({ successes: x.n, success: byId(x.id).success, boom: byId(x.id).boom })) });
  const tier = r.tier.name;
  if (!(tier in WANTED) || got[tier] >= WANTED[tier]) continue;
  got[tier]++;
  usedItems.add(e[0]);
  // the price: level, rarity, attack items worth more; never below what the scrolls cost
  const attack = stat === "PAD" || stat === "MAD";
  const base = 80e3 * 2 ** ((e[2] - 10) / 9);
  let price = base * (attack ? 4 : 1) * r.oneIn ** 0.45 * (0.8 + rnd() * 0.45);
  const scrollCost = rows.reduce((a, x) => a + x.n * (handPrices[x.id] || 0), 0);
  price = Math.min(2e9, Math.max(price, scrollCost * 1.3));
  rnd(); // (kept so the same items come out)
  const forSale = true; // every example has a price
  const i = out.length;
  out.push({
    item: e[0], clean, left, scrolls: rows,
    price: forSale ? nice(price) : null, estimate: null,
    channel: forSale && rnd() < 0.75 ? between(1, 20) : null, room: forSale && rnd() < 0.75 ? between(1, 22) : null,
    where: forSale && rnd() < 0.25 ? pick(WHERE) : null,
    note: (forSale ? pick(NOTES) : pick(SHOW_NOTES)) || null,
    seller: SELLERS[i % SELLERS.length], supporter: false, verified: false, featured: false,
    minutesAgo: between(3, 60 * 60), seenAgo: between(1, 180),
    _tier: tier, _oneIn: Math.round(r.oneIn),
  });
}
fs.writeFileSync(new URL("src/demo.json", root), JSON.stringify(out.map(({ _tier, _oneIn, ...x }) => x)));
console.log(out.length, "examples:", JSON.stringify(got), "| for sale:", out.filter((x) => x.price).length);
for (const x of out.slice(0, 12)) console.log(` ${equips.find((e) => e[0] === x.item)[1]} (L${equips.find((e) => e[0] === x.item)[2]}) ${x._tier} 1 in ${x._oneIn} -> ${x.price ?? "show"}`);
