// Reads a price data file saved from a price site (JSON, any shape) and finds item prices in it.
// It looks for records that have an item id FMCheck knows (as a number or an 8-digit text like "02044701")
// and a price, taking the first price-like field it finds: typical, median, average, price...
const PRICE_KEYS = ["typical", "typicalprice", "median", "medianprice", "avg", "average", "averageprice", "price", "p50", "value", "mean"];
const ID_KEYS = ["id", "itemid", "item_id", "item", "itemId", "item_code", "code"];

const asId = (v) => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d{7,8}$/.test(v.trim())) return +v.trim();
  return null;
};
const asPrice = (v) => {
  const n = typeof v === "string" ? +v.replace(/[,\s]/g, "") : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n < 1e12 ? Math.round(n) : null;
};
const norm = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

// known: Set of ids FMCheck has. Returns { prices: { id: price }, records, matched, priceKey }.
export function findPrices(data, known) {
  const prices = {};
  let records = 0, priceKey = null;
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || depth > 8 || seen.has(node)) return;
    if (typeof node !== "object") return;
    seen.add(node);
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    const keys = Object.keys(node);
    const idKey = keys.find((k) => ID_KEYS.map(norm).includes(norm(k)) && asId(node[k]) != null);
    if (idKey) {
      records++;
      const id = asId(node[idKey]);
      // the price: the first preferred key, also one level down (e.g. { price: { typical: … } })
      let price = null;
      for (const want of PRICE_KEYS) {
        const k = keys.find((x) => norm(x) === want);
        if (k == null) continue;
        const v = node[k];
        price = asPrice(v);
        if (price == null && v && typeof v === "object") {
          for (const w of PRICE_KEYS) { const kk = Object.keys(v).find((x) => norm(x) === w); if (kk && asPrice(v[kk]) != null) { price = asPrice(v[kk]); break; } }
        }
        if (price != null) { priceKey = priceKey || k; break; }
      }
      // not on the record itself: look one level down (e.g. { stats: { median: … } })
      if (price == null) {
        for (const k of keys) {
          const v = node[k];
          if (!v || typeof v !== "object" || Array.isArray(v)) continue;
          for (const w of PRICE_KEYS) { const kk = Object.keys(v).find((x) => norm(x) === w); if (kk && asPrice(v[kk]) != null) { price = asPrice(v[kk]); priceKey = priceKey || `${k}.${kk}`; break; } }
          if (price != null) break;
        }
      }
      if (price != null && known.has(id)) prices[id] = price;
    }
    for (const k of keys) if (node[k] && typeof node[k] === "object") walk(node[k], depth + 1);
  };
  walk(data, 0);
  return { prices, records, matched: Object.keys(prices).length, priceKey };
}
