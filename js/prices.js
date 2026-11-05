// Prices: what the user typed (kept in this browser) wins, then the live feed if one is set up.
import { PRICE_FEED_URL } from "./config.js";

const KEY = "fmcheck-prices-v1";
let saved = {};
let feed = {};
let feedInfo = { source: "manual", updated: null };

try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { saved = {}; }

export async function initPrices() {
  if (!PRICE_FEED_URL) return feedInfo;
  try {
    const r = await fetch(PRICE_FEED_URL, { cache: "no-cache" });
    if (r.ok) {
      const doc = await r.json();
      feed = doc.prices || {};
      feedInfo = { source: "feed", updated: doc.updated || null };
    }
  } catch { /* no feed: manual prices only */ }
  return feedInfo;
}

// { value, from: "you" | "feed" } or null
export function getPrice(id) {
  if (saved[id] != null) return { value: saved[id], from: "you" };
  if (feed[id] != null) return { value: feed[id], from: "feed" };
  return null;
}

export function setPrice(id, value) {
  if (Number.isFinite(value) && value >= 0) saved[id] = value;
  else delete saved[id];
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage off: keep for this visit */ }
}

// Every known price (feed, then what was typed here on top), for exporting the list.
export function allPrices() {
  const out = { ...feed, ...saved };
  for (const k of Object.keys(out)) if (!Number.isFinite(out[k])) delete out[k];
  return out;
}
