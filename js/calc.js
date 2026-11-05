// Pure math for FMCheck: stat roll ranges, scroll odds and the value estimate.
// No DOM here, so it can be tested with `node --test`.

// Item stat keys (WZ inc* names without "inc"), with display labels.
export const STATS = [
  ["PAD", "ATT"], ["MAD", "M.ATT"], ["STR", "STR"], ["DEX", "DEX"], ["INT", "INT"], ["LUK", "LUK"],
  ["ACC", "ACC"], ["EVA", "AVOID"], ["Speed", "Speed"], ["Jump", "Jump"],
  ["MHP", "HP"], ["MMP", "MP"], ["PDD", "W.DEF"], ["MDD", "M.DEF"], ["CRT", "Crit"], ["CRD", "Crit DMG"],
];
export const STAT_LABEL = Object.fromEntries(STATS);

// Defense and HP/MP vary more than the other stats on a dropped item.
const WIDE = new Set(["PDD", "MDD", "MHP", "MMP"]);

// Range a dropped item's stat can roll in: base ± min(ceil(10% of base), 5), or 10 for DEF/HP/MP.
// This is the commonly used pre-Big-Bang rule; treat it as close, not exact.
export function statRange(key, base) {
  if (!base) return [0, 0];
  const r = Math.min(Math.ceil(base * 0.1), WIDE.has(key) ? 10 : 5);
  return [Math.max(0, base - r), base + r];
}

// Chance a fresh drop rolls this stat at `value` or higher. Rolls are treated as evenly spread over the range.
export function rollAtLeast(key, base, value) {
  const [lo, hi] = statRange(key, base);
  if (value <= lo) return 1;
  if (value > hi) return 0;
  return (hi - value + 1) / (hi - lo + 1);
}

export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

// Chance that `used` scrolls give at least `successes` passes and the item survives.
// success: % chance to pass; boom: % of failures that destroy the item (dark scrolls: 50).
export function groupOdds(used, successes, success, boom = 0) {
  const p = success / 100;
  const failKeep = (1 - p) * (1 - boom / 100);
  let total = 0;
  for (let k = successes; k <= used; k++) total += choose(used, k) * p ** k * failKeep ** (used - k);
  return Math.min(1, total);
}

// Final stats: the clean roll plus every passed scroll's gains.
export function finalStats(clean, groups) {
  const out = { ...clean };
  for (const g of groups) {
    for (const [k, v] of Object.entries(g.stats || {})) out[k] = (out[k] || 0) + v * g.successes;
  }
  return out;
}

// The value estimate.
//
// The idea: what would it cost, on average, to make an item at least this good from scratch?
// One "try" = buy a clean item and spend the same scrolls on it. A try works when the clean roll is
// at least as good and each scroll group passes at least as often (and nothing booms).
//   estimate = (clean price + scrolls per try) / chance a try works
//
// input: {
//   cleanPrice,                       mesos for an average clean item
//   roll: { key, base, value } | null the stat whose clean roll counts (usually ATT on weapons)
//   groups: [{ used, successes, success, boom, price }]
// }
export function estimate({ cleanPrice = 0, roll = null, groups = [] }) {
  const scrollCost = groups.reduce((s, g) => s + (g.used || 0) * (g.price || 0), 0);
  const tryCost = cleanPrice + scrollCost;
  const rollChance = roll ? rollAtLeast(roll.key, roll.base, roll.value) : 1;
  const scrollChance = groups.reduce((c, g) => c * groupOdds(g.used || 0, g.successes || 0, g.success, g.boom), 1);
  const chance = rollChance * scrollChance;
  const value = chance > 0 ? tryCost / chance : Infinity;
  return {
    tryCost, scrollCost, rollChance, scrollChance, chance,
    oneIn: chance > 0 ? 1 / chance : Infinity,
    value,
  };
}

// 1234567 -> "1.23m", 45000 -> "45k", 2.5e9 -> "2.5b"
export function mesos(n) {
  if (!Number.isFinite(n)) return "∞";
  const a = Math.abs(n);
  const fmt = (v, s) => `${(+v.toPrecision(3)).toLocaleString("en-US")}${s}`;
  if (a >= 1e9) return fmt(n / 1e9, "b");
  if (a >= 1e6) return fmt(n / 1e6, "m");
  if (a >= 1e3) return fmt(n / 1e3, "k");
  return String(Math.round(n));
}

// "12m", "1.5b", "300k", "45,000" -> mesos. Returns NaN when unreadable.
export function parseMesos(text) {
  const t = String(text ?? "").trim().toLowerCase().replace(/,/g, "");
  if (!t) return NaN;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([kmb]?)$/);
  if (!m) return NaN;
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]];
  return Math.round(parseFloat(m[1]) * mult);
}

// The user says how many slots are left and which scrolls passed, but not which ones failed.
// Spread the failed slots over the scroll types in the most likely way.
// types: [{ successes, success, boom }], failed: number of failed slots -> [failed slots per type]
export function allocateFailures(types, failed) {
  if (!types.length || failed <= 0) return types.map(() => 0);
  let best = null, bestLike = -1;
  const alloc = new Array(types.length).fill(0);
  const like = () => types.reduce((l, t, i) => {
    const q = (1 - t.success / 100) * (1 - (t.boom || 0) / 100);
    return l * choose(t.successes + alloc[i], alloc[i]) * q ** alloc[i];
  }, 1);
  (function walk(i, left) {
    if (i === types.length - 1) {
      alloc[i] = left;
      const l = like();
      if (l > bestLike) { bestLike = l; best = alloc.slice(); }
      return;
    }
    for (let f = 0; f <= left; f++) { alloc[i] = f; walk(i + 1, left - f); }
  })(0, failed);
  return best;
}

// Price fields: a number box plus a unit dropdown (mesos, k, m, b).
export const UNITS = [["", "mesos", 1], ["k", "K", 1e3], ["m", "M", 1e6], ["b", "B", 1e9]];

// Number box text + chosen unit -> mesos. A unit typed in the box ("2m") wins over the dropdown.
export function readPrice(text, unit) {
  const t = String(text ?? "").trim().toLowerCase().replace(/,/g, "");
  if (/[kmb]$/.test(t)) return parseMesos(t);
  const n = /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
  const mult = (UNITS.find((u) => u[0] === unit) || UNITS[0])[2];
  return Number.isFinite(n) ? Math.round(n * mult) : NaN;
}

// mesos -> { num, unit } for filling a field back in, e.g. 1980000 -> { num: "1.98", unit: "m" }
export function splitPrice(v) {
  const u = [...UNITS].reverse().find(([, , m]) => m > 1 && v >= m) || UNITS[0];
  return { num: String(+(v / u[2]).toPrecision(6)), unit: u[0] };
}

// "from" and "to" boxes sharing one unit -> { lo, hi } in mesos, or null when both are empty.
// One box filled means an exact price; a reversed range is put in order.
export function readRange(from, to, unit) {
  let lo = readPrice(from, unit), hi = readPrice(to, unit);
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return null;
  if (!Number.isFinite(lo)) lo = hi;
  if (!Number.isFinite(hi)) hi = lo;
  return lo <= hi ? { lo, hi } : { lo: hi, hi: lo };
}

// What the open slots add: the buyer can still scroll them.
// Each open slot is valued as one more scroll of the reference type (the passed scroll used most):
//   per slot = chance it passes × stat it adds × mesos per stat point − scroll price   (never below 0)
// Mesos per stat point comes from this item's own estimate: (estimate − clean price) ÷ stat points gained.
// ref: { success, boom, points (stat points one pass adds), price }
export function openSlotValue({ value, cleanPrice, pointsGained, slotsLeft, ref }) {
  if (!ref || slotsLeft <= 0 || pointsGained <= 0 || !Number.isFinite(value)) return { perPoint: 0, perSlot: 0, total: 0 };
  const perPoint = Math.max(0, (value - cleanPrice) / pointsGained);
  // A Chaos scroll that booms loses the whole item, so count that loss too.
  const boomLoss = (1 - ref.success / 100) * ((ref.boom || 0) / 100) * value;
  const perSlot = Math.max(0, (ref.success / 100) * ref.points * perPoint - ref.price - boomLoss);
  return { perPoint, perSlot, total: perSlot * slotsLeft };
}

// ---------- Cheapest way to make an item at least this good ----------
//
// The community prices a scrolled item by what it would cost a buyer to make one at least as good
// themselves, the cheapest way they can ("price ceiling = cheapest other route to the same result").
//
// Goal: gain at least `needs[f]` stat points in each scroll family f (e.g. "Gloves Attack Scroll"),
// using at most `slots` slots (the item's used slots, so the copy keeps as many open slots).
// Tools: every tier of those families with a known price (Lesser / Intermediate / Greater / Chaos).
// The maker plays it smart: picks the best scroll for each step, stops once the goal is reached,
// and drops an item that can no longer reach it (or that a Chaos scroll destroyed) and starts over
// with a fresh clean item.
//
// Let M = the average total cost to finish one item (clean items + scrolls, retries included).
//   C(s, need) = expected cost from here, with s slots left and `need` points still missing
//   C(s, 0) = 0                                       goal reached
//   C(s, need) = M  when the goal can't be reached     drop it, start over
//   C(s, need) = min( M,  min over scrolls t: price_t + p_t·C(s−1, need−gain_t)
//                                                    + (1−p_t)(1−boom_t)·C(s−1, need) + (1−p_t)·boom_t·M )
//   M = clean price + C(slots, needs)                 solved by repeating until it settles
//
// tiers: [{ fam, points, success, boom, price, id }], needs: { fam: points }
export function cheapestRoute({ cleanPrice, slots, needs, tiers }) {
  const fams = Object.keys(needs).filter((f) => needs[f] > 0);
  if (!fams.length) return { cost: cleanPrice, chance: 1, cleanItems: 1, uses: {}, first: null };
  const usable = tiers.filter((t) => fams.includes(t.fam) && Number.isFinite(t.price) && t.points > 0);
  const best = Object.fromEntries(fams.map((f) => [f, Math.max(0, ...usable.filter((t) => t.fam === f).map((t) => t.points))]));
  if (fams.some((f) => !best[f])) return null; // a family with no priced scroll

  const reachable = (s, need) => fams.reduce((n, f, i) => n + Math.ceil(Math.max(0, need[i]) / best[f]), 0) <= s;
  const key = (s, need) => s + ":" + need.join(",");
  const start = fams.map((f) => needs[f]);
  if (!reachable(slots, start)) return null;

  function solve(M) {
    const memo = new Map();
    const C = (s, need) => {
      if (need.every((n) => n <= 0)) return { cost: 0, pick: null };
      if (!reachable(s, need)) return { cost: M, pick: "drop" };
      const k = key(s, need);
      if (memo.has(k)) return memo.get(k);
      let out = { cost: M, pick: "drop" };
      for (const t of usable) {
        const i = fams.indexOf(t.fam);
        if (need[i] <= 0) continue;
        const p = t.success / 100, b = (t.boom || 0) / 100;
        const after = need.slice(); after[i] -= t.points;
        const c = t.price + p * C(s - 1, after).cost + (1 - p) * (1 - b) * C(s - 1, need).cost + (1 - p) * b * M;
        if (c < out.cost - 1e-9) out = { cost: c, pick: t };
      }
      memo.set(k, out);
      return out;
    };
    return C;
  }

  // Find M where M = clean + cost of the first step onward (no dropping a fresh item).
  let M = cleanPrice + 1, C;
  for (let it = 0; it < 500; it++) {
    C = solve(M);
    let first = Infinity;
    for (const t of usable) { // the first step must use a scroll
      const i = fams.indexOf(t.fam);
      if (start[i] <= 0) continue;
      const p = t.success / 100, b = (t.boom || 0) / 100;
      const after = start.slice(); after[i] -= t.points;
      first = Math.min(first, t.price + p * C(slots - 1, after).cost + (1 - p) * (1 - b) * C(slots - 1, start).cost + (1 - p) * b * M);
    }
    const next = cleanPrice + first;
    if (!Number.isFinite(next) || next > 1e15) return null;
    if (Math.abs(next - M) <= 1e-7 * next) { M = next; break; }
    M = next;
  }
  C = solve(M);

  // Follow the chosen plan from a fresh item: chance it ends finished, and scrolls used per fresh item.
  const uses = {};
  let firstPick = null;
  const walk = (s, need, prob, top) => {
    if (prob < 1e-12) return 0;
    if (need.every((n) => n <= 0)) return prob;
    let pick = C(s, need).pick;
    if (top) { // fresh item: best scroll, never drop
      let bestC = Infinity;
      for (const t of usable) {
        const i = fams.indexOf(t.fam); if (need[i] <= 0) continue;
        const p = t.success / 100, b = (t.boom || 0) / 100; const after = need.slice(); after[i] -= t.points;
        const c = t.price + p * C(s - 1, after).cost + (1 - p) * (1 - b) * C(s - 1, need).cost + (1 - p) * b * M;
        if (c < bestC) { bestC = c; pick = t; }
      }
      firstPick = pick;
    }
    if (!pick || pick === "drop") return 0;
    uses[pick.id] = (uses[pick.id] || 0) + prob;
    const p = pick.success / 100, b = (pick.boom || 0) / 100, i = fams.indexOf(pick.fam);
    const after = need.slice(); after[i] -= pick.points;
    return walk(s - 1, after, prob * p, false) + walk(s - 1, need, prob * (1 - p) * (1 - b), false);
  };
  const chance = walk(slots, start, 1, true);
  return { cost: M, chance, cleanItems: chance > 0 ? 1 / chance : Infinity, uses, first: firstPick };
}
