// Reads a price data file saved from a price site (JSON, any shape) and works out one price per item.
// It looks for records with an item id FMCheck knows (a number, an 8-digit text like "02044701", or "basil:02044701")
// and a price. When a file lists many offers per item (a market snapshot), they're combined:
//   scrolls: the middle asking price; equipment: the price at the cheapest quarter (clean ones are the cheap ones,
//   scrolled ones are listed higher). Items with fewer than MIN_OFFERS offers are left out.
// Only the item and the price are used: nothing else in the file (like who's selling) is kept.
const PRICE_KEYS = ["typical", "typicalprice", "median", "medianprice", "avg", "average", "averageprice", "price", "p50", "value", "mean"];
const ID_KEYS = ["id", "itemid", "item_id", "item", "itemId", "item_code", "code"];
export const MIN_OFFERS = 3;

const asId = (v) => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string") {
    const m = /^(?:[a-z]+:)?(\d{7,8})$/.exec(v.trim());
    if (m && !/^cash:/.test(v.trim())) return +m[1];
  }
  return null;
};
const asPrice = (v) => {
  const n = typeof v === "string" ? +v.replace(/[,\s]/g, "") : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n < 1e12 ? Math.round(n) : null;
};
const norm = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const quantile = (xs, q) => {
  const s = xs.slice().sort((a, b) => a - b), k = (s.length - 1) * q, lo = Math.floor(k), hi = Math.min(lo + 1, s.length - 1);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (k - lo));
};

// known: Set of ids FMCheck has. Returns { prices: { id: price }, records, matched, priceKey, offers }.
export function findPrices(data, known) {
  const all = new Map();
  let records = 0, priceKey = null;
  const seen = new Set();
  const priceIn = (obj) => {
    const keys = Object.keys(obj);
    for (const want of PRICE_KEYS) {
      const k = keys.find((x) => norm(x) === want);
      if (k == null) continue;
      const v = obj[k];
      let p = asPrice(v);
      if (p == null && v && typeof v === "object") {
        for (const w of PRICE_KEYS) { const kk = Object.keys(v).find((x) => norm(x) === w); if (kk && asPrice(v[kk]) != null) { p = asPrice(v[kk]); break; } }
      }
      if (p != null) return [p, k];
    }
    // one level down (e.g. { stats: { median: … } })
    for (const k of keys) {
      const v = obj[k];
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      for (const w of PRICE_KEYS) { const kk = Object.keys(v).find((x) => norm(x) === w); if (kk && asPrice(v[kk]) != null) return [asPrice(v[kk]), `${k}.${kk}`]; }
    }
    return [null, null];
  };
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    const keys = Object.keys(node);
    // the item id: an id-like key, preferring one that FMCheck knows
    const idKeys = keys.filter((k) => ID_KEYS.map(norm).includes(norm(k)) && asId(node[k]) != null);
    const idKey = idKeys.find((k) => known.has(asId(node[k]))) || idKeys[0];
    if (idKey) {
      records++;
      const id = asId(node[idKey]);
      const [price, k] = priceIn(node);
      if (price != null) priceKey = priceKey || k;
      if (price != null && known.has(id)) { if (!all.has(id)) all.set(id, []); all.get(id).push(price); }
    }
    for (const k of keys) if (node[k] && typeof node[k] === "object") walk(node[k], depth + 1);
  };
  walk(data, 0);
  const prices = {}, offers = {};
  for (const [id, ps] of all) {
    if (ps.length === 1) { prices[id] = ps[0]; offers[id] = 1; continue; } // one price per item: a price list
    if (ps.length < MIN_OFFERS) continue;
    prices[id] = quantile(ps, id < 2000000 ? 0.25 : 0.5);
    offers[id] = ps.length;
  }
  // a market snapshot (many offers per item): single offers aren't a price
  const snapshot = [...all.values()].some((ps) => ps.length > 1);
  if (snapshot) for (const id of Object.keys(prices)) if (offers[id] === 1) { delete prices[id]; delete offers[id]; }
  return { prices, records, matched: Object.keys(prices).length, priceKey, offers, snapshot };
}
