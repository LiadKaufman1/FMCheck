// How rare an item is: its natural (clean) roll and the way its scrolls passed. Used by the page and the server.
//
//   roll    = for every stat the drop rolled ABOVE the item's default: the chance a drop rolls it at least that high,
//             multiplied together (stats at or below the default don't make it rarer)
//   scrolls = the chance the scrolls passed like this in the used slots (failed slots spread the likeliest way)
//   chance  = roll × scrolls, shown as "1 in N" with a tier
import { rollAtLeast, groupOdds, allocateFailures } from "./calc.js?v=e4efec93";

export const TIERS = [
  // [name, "1 in" from, colour]
  ["Common", 1, "#b9bdd1"],
  ["Uncommon", 5, "#7ddc6a"],
  ["Rare", 50, "#5aa8ff"],
  ["Epic", 500, "#c77dff"],
  ["Legendary", 5000, "#ffb83d"],
];
export const tierOf = (oneIn) => {
  let t = TIERS[0];
  for (const x of TIERS) if (oneIn >= x[1]) t = x;
  return { name: t[0], color: t[2] };
};

// base: the item's default stats. clean: its clean roll. used: slots used. rows: [{ successes, success, boom }].
export function rarity({ base = {}, clean = {}, used = 0, rows = [] }) {
  const parts = [];
  let roll = 1;
  for (const [k, def] of Object.entries(base)) {
    const v = clean[k] ?? def;
    if (v <= def) continue;
    const p = rollAtLeast(k, def, v);
    if (p < 1) { parts.push({ k, value: v, p }); roll *= p; }
  }
  const passed = rows.reduce((a, r) => a + r.successes, 0);
  const failed = Math.max(0, used - passed);
  const fails = allocateFailures(rows, failed);
  const scrolls = rows.reduce((c, r, i) => c * groupOdds(r.successes + fails[i], r.successes, r.success, r.boom), 1);
  const chance = roll * scrolls;
  const oneIn = chance > 0 ? Math.min(1 / chance, 1e15) : 1e15;
  return { roll, rollParts: parts, scrolls, failed, chance, oneIn, tier: tierOf(oneIn) };
}

// "1 in 3,400", "1 in 2.1M", "every item"
export function oneInText(n) {
  if (n < 1.05) return "almost every item";
  if (n < 10) return `1 in ${+n.toFixed(1)}`;
  if (n < 1e6) return `1 in ${Math.round(n).toLocaleString("en-US")}`;
  if (n < 1e9) return `1 in ${+(n / 1e6).toFixed(1)}M`;
  return `1 in ${+(n / 1e9).toFixed(1)}B`;
}
