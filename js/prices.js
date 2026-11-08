// Scroll prices the user typed, remembered in this browser so they don't retype them next time.
const KEY = "fmcheck-prices-v2"; // v2: Classic item ids (v1 used GMS v83 ids)
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { saved = {}; }

// FMCheck's price list (kept by hand by admins, /api/prices): used wherever the player didn't type a price.
let site = {}, siteUpdated = 0;
export function setSitePrices(prices, updated) { site = prices || {}; siteUpdated = updated || 0; }
export const sitePrice = (id) => site[id] || null;
export const siteDate = () => siteUpdated;

// The price the player typed: { lo, hi } in mesos (both the same: one average price), or null.
// Older saves hold one number, or a range from when prices were typed as from–to: that becomes its middle.
export function getUserPrice(id) {
  const v = saved[id];
  if (v == null) return null;
  const p = typeof v === "number" ? v : Math.round((v.lo + v.hi) / 2);
  return { lo: p, hi: p };
}

// The price to use: the player's, else FMCheck's list (marked site: true), else null.
export function getPrice(id) {
  const own = getUserPrice(id);
  if (own) return own;
  const p = site[id];
  return p ? { lo: p, hi: p, site: true } : null;
}

export function setPrice(id, range) {
  if (range && Number.isFinite(range.lo) && Number.isFinite(range.hi)) saved[id] = { lo: range.lo, hi: range.hi };
  else delete saved[id];
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage off: keep for this visit */ }
}
