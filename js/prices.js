// Scroll prices the user typed, remembered in this browser so they don't retype them next time.
const KEY = "fmcheck-prices-v1";
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { saved = {}; }

// { value } or null
export function getPrice(id) {
  return saved[id] != null ? { value: saved[id] } : null;
}

export function setPrice(id, value) {
  if (Number.isFinite(value) && value >= 0) saved[id] = value;
  else delete saved[id];
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage off: keep for this visit */ }
}
