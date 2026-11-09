// Turns the text read from a picture of an in-game item window into an item: which item it is, its stats,
// slots left, and the most likely scrolls and clean roll. No page or picture code here (tests run it in Node).
//
// What the window shows: "Dark Crusader Chainmail (M) (+1)", "REQ LEV : 35", "Type: Outfit",
// "Weapon Def.: +117 (115 +2)", "Remaining Enhancements: 5". The number in brackets is the item's default stat
// plus everything added since (the clean roll and the scrolls together), so the scrolls are worked out:
// the passes (+1) must add up so that every clean stat is one a drop can roll.
import { statRange } from "./calc.js?v=0f1f7cd5";

const LABELS = [
  ["PAD", "weapon att"], ["MAD", "magic att"], ["PDD", "weapon def"], ["MDD", "magic def"],
  ["MHP", "maxhp"], ["MMP", "maxmp"], ["ACC", "accuracy"], ["EVA", "avoidability"], ["Speed", "speed"], ["Jump", "jump"],
  ["CRT", "critical rate"], ["CRD", "critical damage"], ["STR", "str"], ["DEX", "dex"], ["INT", "int"], ["LUK", "luk"],
];
const TYPES = { outfit: "Overall", overall: "Overall", top: "Top", bottom: "Bottom", gloves: "Glove", glove: "Glove", shoes: "Shoes",
  hat: "Hat", cap: "Hat", cape: "Cape", earrings: "Earring", earring: "Earring", shield: "Shield" };

const letters = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
// letters that are often read as digits, and the reverse
const toDigits = (s) => s.replace(/[oOQ]/g, "0").replace(/[lI|!]/g, "1").replace(/[sS]/g, "5").replace(/[B]/g, "8");

// How alike two strings are (0..1), by shared letter pairs. Copes with misread letters.
function similar(a, b) {
  a = letters(a); b = letters(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pairs = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) || 0) + 1); } return m; };
  const pa = pairs(a), pb = pairs(b);
  let both = 0;
  for (const [p, n] of pa) both += Math.min(n, pb.get(p) || 0);
  return (2 * both) / (a.length - 1 + b.length - 1 || 1);
}

// The facts in the text: stat lines, slots left, (+N), requirements, type, and lines that could be the name.
export function parseWindow(text) {
  // accents off ("Véeaporn" -> "Veeaporn"), so misread letters still look like the label
  const lines = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  const out = { stats: {}, left: null, upgrades: null, ups: [], req: {}, type: null, nameLines: [] };
  for (const raw of lines) {
    const low = raw.toLowerCase();
    // "(+1)" after the name: every one seen, since other text in the picture can have one too
    for (const up of raw.matchAll(/[({]\s*\+\s*([0-9oOlI]{1,2})\s*[)}]/g)) out.ups.push(+toDigits(up[1]));
    if (out.upgrades == null && out.ups.length) out.upgrades = out.ups[0];
    if (/enhanc|upgrades?\s*avail/.test(low)) {
      const m = /([0-9oOlI|sS]{1,2})\s*$/.exec(raw.replace(/[^\w\s]+$/, ""));
      if (m && /^\d+$/.test(toDigits(m[1]))) out.left = +toDigits(m[1]);
      continue;
    }
    const req = /re[qa0o]\s*[^a-z]*\s*(lev|lv|str|dex|int|luk|fam)\w*[^0-9]*([0-9oOlI]{1,3})/i.exec(raw);
    if (req) { out.req[req[1].toLowerCase().replace("lv", "lev")] = +toDigits(req[2]); continue; }
    const type = /type\s*[:;.]?\s*([a-z]+)/i.exec(raw)
      || (raw.length < 28 && /^[^a-z]*t[a-z]{1,3}e?\b.*?\b(outfit|overall|top|bottom|gloves?|shoes|hat|cap|cape|earrings?|shield)\b/i.exec(raw));
    if (type) { if (!out.type && TYPES[type[1].toLowerCase()]) out.type = TYPES[type[1].toLowerCase()]; continue; }
    // a stat line: a label, then "+number" (the bracket after it isn't needed: the default comes from the game data)
    // the number can come out split ("+1 17" for +117): single spaces between digits are dropped
    const stat = /([a-z][a-z .']{1,22}?)\s*[:;.]?\s*[+#*]\s*([0-9oOlIsS](?: ?[0-9oOlIsS]){0,3})(?![0-9])/i.exec(raw);
    if (stat) {
      // the label: its last two words (junk read before it, like "x" or "E. {", is dropped)
      const label = stat[1].trim().split(/\s+/).slice(-2).join(" ");
      let best = null, score = 0;
      for (const [k, name] of LABELS) {
        const s = similar(label, name) + (letters(label).startsWith(letters(name).slice(0, 3)) ? 0.15 : 0);
        if (s > score) { score = s; best = k; }
      }
      const v = +toDigits(stat[2].replace(/ /g, ""));
      if (best && score >= 0.45 && Number.isFinite(v) && out.stats[best] == null) { out.stats[best] = v; continue; }
    }
    if (/[a-z]{3}/i.test(raw) && !/beginner|warrior|magician|bowman|thief/i.test(raw)) out.nameLines.push(raw);
  }
  return out;
}

const catOf = (e) => (Math.floor(e[0] / 10000) >= 130 ? "Weapon" : e[3]);

// Which item it most likely is: the name, then the requirements, type, stats and slots that fit.
export function findItem(read, equips) {
  const names = read.nameLines.slice(0, 6);
  const joined = [];
  for (let i = 0; i < names.length; i++) {
    joined.push(names[i]);
    if (names[i + 1]) joined.push(`${names[i]} ${names[i + 1]}`);
  }
  const clean = (s) => s.replace(/\([^)]*\)/g, " ");
  const scored = equips.map((e) => {
    const nm = Math.max(0, ...joined.map((l) => similar(clean(l), e[1])));
    let s = nm * 4;
    const req = (e[6] && e[6].req) || [0, 0, 0, 0];
    if (read.req.lev != null) s += read.req.lev === e[2] ? 1.5 : -1;
    for (const [i, k] of ["str", "dex", "int", "luk"].entries()) if (read.req[k] != null) s += read.req[k] === req[i] ? 0.5 : -0.5;
    if (read.type) s += read.type === e[3] || read.type === catOf(e) ? 1 : -0.5;
    const keys = Object.keys(read.stats);
    if (keys.length) s += keys.filter((k) => k in e[5]).length / keys.length;
    if (read.left != null && read.left > e[4]) s -= 3;
    return { e, s, nm };
  }).sort((a, b) => b.s - a.s);
  return scored.slice(0, 4);
}

// The likeliest scrolls: `passes` of this item's scrolls (or, if unknown, any number that fits the used slots),
// such that every clean stat (final minus what the scrolls added) is one a drop can roll.
export function guessScrolls(equip, read, scrolls) {
  const base = equip[5] || {};
  const slots = equip[4];
  const left = read.left != null && read.left <= slots ? read.left : null;
  const used = left != null ? slots - left : slots;
  const target = Math.floor(equip[0] / 10000);
  const keys = Object.keys(read.stats);
  const cands = scrolls.filter((s) => s.target === target && Object.keys(s.stats).every((k) => keys.includes(k)));
  const range = {};
  for (const k of keys) range[k] = base[k] ? statRange(k, base[k]) : [0, 0];
  // the (+N) read that fits this item's used slots; otherwise try every number of passes
  const up = (read.ups && read.ups.length ? read.ups : read.upgrades != null ? [read.upgrades] : []).find((n) => n <= used);
  const passList = up != null ? [up] : [...Array(Math.min(used, 10) + 1).keys()];
  const results = [];
  for (const passes of passList) {
    const counts = new Array(cands.length).fill(0);
    const gain = Object.fromEntries(keys.map((k) => [k, 0]));
    const walk = (i, n) => {
      if (n === 0) {
        const clean = {};
        for (const k of keys) {
          const c = read.stats[k] - gain[k];
          if (c < range[k][0] || c > range[k][1]) return;
          clean[k] = c;
        }
        let p = 1;
        const rows = [];
        counts.forEach((c, j) => { if (c) { p *= (cands[j].success / 100) ** c; rows.push({ id: cands[j].id, n: c }); } });
        // failed slots: likelier with the scroll that was actually being used
        const fails = used - passes;
        if (fails > 0) p *= (1 - Math.max(...rows.map((r) => cands.find((c) => c.id === r.id).success / 100), 0.4)) ** fails;
        // a clean roll near the item's default is likelier to be what the player has
        const off = keys.reduce((a, k) => a + Math.abs(clean[k] - (base[k] || 0)), 0);
        results.push({ rows, clean, passes, p: p / (1 + off * 0.05) });
        return;
      }
      if (i >= cands.length) return;
      for (let c = n; c >= 0; c--) {
        const st = cands[i].stats;
        let ok = true;
        for (const [k, v] of Object.entries(st)) { gain[k] += v * c; if (read.stats[k] - gain[k] < range[k][0]) ok = false; }
        counts[i] = c;
        if (ok) walk(i + 1, n - c);
        for (const [k, v] of Object.entries(st)) gain[k] -= v * c;
        counts[i] = 0;
        if (results.length > 4000) return;
      }
    };
    walk(0, passes);
  }
  results.sort((a, b) => b.p - a.p);
  const fullClean = (r) => ({ ...base, ...r.clean });
  return {
    left: left ?? (results[0] ? slots - Math.max(results[0].passes, 0) : slots),
    best: results[0] ? { rows: results[0].rows, clean: fullClean(results[0]), passes: results[0].passes } : null,
    others: results.slice(1, 4).map((r) => ({ rows: r.rows, clean: fullClean(r), passes: r.passes })),
  };
}
