// Reading an item tooltip from a screenshot or photo.
// The text recognition (Tesseract.js) runs in the visitor's browser: the image never leaves their device.
// The parsing below is plain text work, so it can be tested with `node --test`.

// Tooltip labels -> stat keys. Order matters: more specific labels first.
const LABELS = [
  [/critical\s*dam/i, "CRD"], [/crit/i, "CRT"],
  [/weapon\s*def|w\.?\s*def/i, "PDD"], [/magic\s*def|m\.?\s*def/i, "MDD"],
  [/magic\s*att|m\.?\s*att/i, "MAD"], [/weapon\s*att|attack|w\.?\s*att/i, "PAD"],
  [/accura/i, "ACC"], [/avoid/i, "EVA"], [/speed/i, "Speed"], [/jump/i, "Jump"],
  [/max\s*hp|\bhp\b/i, "MHP"], [/max\s*mp|\bmp\b/i, "MMP"],
  [/\bstr\b/i, "STR"], [/\bdex\b/i, "DEX"], [/\bint\b/i, "INT"], [/\bluk\b/i, "LUK"],
];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// Similarity of two strings by shared letter pairs (0..1), forgiving OCR slips.
function similar(a, b) {
  const pairs = (s) => { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); out.set(p, (out.get(p) || 0) + 1); } return out; };
  const A = pairs(a), B = pairs(b);
  let hit = 0, total = 0;
  for (const [p, n] of A) { total += n; hit += Math.min(n, B.get(p) || 0); }
  for (const n of B.values()) total += n;
  return total ? (2 * hit) / total : 0;
}

// text: what the recognition read. equips: [id, name, ...] from data/equips.json.
// -> { item: [id, name, ...] | null, upgrades, left, stats: { key: { total, base, gain } }, confidence }
export function parseTooltip(text, equips) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/[|“”"]/g, " ").trim()).filter(Boolean);
  const flat = norm(lines.join(" "));

  // Item: the longest equip name found in the text; otherwise the closest match to the title line.
  let item = null, best = 0;
  for (const e of equips) {
    const n = norm(e[1]);
    if (n.length > 3 && flat.includes(n) && n.length > best) { item = e; best = n.length; }
  }
  let confidence = item ? 1 : 0;
  if (!item) {
    const titled = lines.filter((l) => /\(\s*\+\s*\d+\s*\)/.test(l));
    for (const title of (titled.length ? titled : lines.slice(0, 4))) {
      const t = norm(title.replace(/\(.*$/, ""));
      if (t.length < 4) continue;
      for (const e of equips) {
        const sc = similar(t, norm(e[1]));
        if (sc > confidence) { confidence = sc; item = e; }
      }
    }
    if (confidence < 0.45) { item = null; confidence = 0; }
  }

  // Stats first (needed below to guess the item when its name can't be read).
  const stats = {};
  for (const line of lines) {
    if (/^req|remaining|type\s*:/i.test(line)) continue;
    const label = LABELS.find(([re]) => re.test(line));
    if (!label) continue;
    // "+5 (1 +4)" or "+6"
    // "+5 (1 +4)", "+113 (115 -2)" or "+6". In brackets: the item's default value and the difference from it.
    const m = line.match(/[:;]?\s*\+\s*(\d{1,4})\s*(?:\(\s*(\d{1,4})\s*([+\-−–])\s*(\d{1,4})\s*\))?/);
    if (!m) continue;
    const total = +m[1];
    const base = m[2] != null ? +m[2] : total;
    const gain = m[4] != null ? (m[3] === "+" ? 1 : -1) * +m[4] : 0;
    stats[label[1]] = { total, base, gain };
  }

  // No name: rank the items whose own stats fit the clean values read. Pick one only when it's clear
  // (two or more stats fit and the text names its type, e.g. "Type: Gloves"); otherwise offer suggestions.
  let suggestions = [];
  if (!item && Object.keys(stats).length) {
    const own = Object.entries(stats).filter(([k]) => !["ACC", "EVA", "Speed", "Jump", "MAD"].includes(k) || stats[k].base);
    const fits = [];
    for (const e of equips) {
      const base = e[5] || {};
      let fit = 0, ok = true;
      for (const [k, v] of own) {
        if (!base[k]) { if (v.base) { ok = false; break; } continue; }
        const range = Math.min(Math.ceil(base[k] * 0.1), ["PDD", "MDD", "MHP", "MMP"].includes(k) ? 10 : 5);
        if (Math.abs(v.base - base[k]) > range) { ok = false; break; }
        fit += 2 - Math.abs(v.base - base[k]) / (range || 1);
      }
      if (!ok || !fit) continue;
      const typed = !!(e[3] && flat.includes(norm(e[3]))); // e.g. "Type: Glove"
      fits.push({ e, fit: fit + (typed ? 3 : 0), typed });
    }
    fits.sort((a, b) => b.fit - a.fit);
    const top = fits[0];
    if (top && top.typed && own.length >= 2 && (!fits[1] || fits[1].fit < top.fit)) { item = top.e; confidence = 0.6; }
    else suggestions = fits.slice(0, 6).map((f) => f.e);
  }

  const upgrades = (() => { const m = lines.join(" ").match(/\(\s*\+\s*(\d{1,2})\s*\)/); return m ? +m[1] : null; })();
  const left = (() => {
    const m = lines.join(" ").match(/(?:remaining\s*enhance\w*|upgrades?\s*avail\w*|slots?\s*left)\D{0,6}(\d{1,2})/i);
    return m ? +m[1] : null;
  })();

  return { item, upgrades, left, stats, confidence, suggestions };
}

// ---------- text recognition in the browser ----------

const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = TESSERACT;
      s.onload = () => ok(window.Tesseract);
      s.onerror = () => { loading = null; fail(new Error("Couldn't load the text reader")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// Game tooltips are light text on a dark panel; recognition reads dark text on light best.
// Each pass prepares the picture differently: "auto" flips dark pictures, "flip"/"keep" force it, "sharp" adds a hard
// threshold, and "text" keeps only the tooltip's bright text (white and yellow) so a busy game map behind it disappears.
async function prepare(file, how = "auto") {
  const img = await createImageBitmap(file);
  const scale = Math.min(3, Math.max(2000 / img.width, Math.min(1, 2400 / img.width)));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height), px = d.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const mean = sum / (px.length / 4);
  const flip = how === "flip" || how === "sharp" ? true : how === "keep" ? false : mean < 128;
  if (how === "text") {
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gr = px[i + 1], b = px[i + 2];
      const white = r > 175 && gr > 175 && b > 175, yellow = r > 190 && gr > 150 && b < 120;
      px[i] = px[i + 1] = px[i + 2] = white || yellow ? 0 : 255;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }
  for (let i = 0; i < px.length; i += 4) {
    let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (flip) g = 255 - g;
    g = how === "sharp" ? (g > 150 ? 255 : 0) : Math.max(0, Math.min(255, (g - 60) * 1.6));
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

// How much a reading found (used to keep the best of several passes).
export function richness(p) {
  return (p.item ? 6 * (p.confidence || 1) : 0) + (p.upgrades != null ? 1 : 0) + (p.left != null ? 1 : 0) + Object.keys(p.stats).length;
}

// Combine several readings: the item from the surest one, each number by vote (ties go to the richest reading).
export function mergeReadings(list) {
  if (!list.length) return null;
  const byRich = list.slice().sort((a, b) => richness(b) - richness(a));
  const vote = (vals) => {
    const n = new Map();
    for (const v of vals) if (v != null) n.set(v, (n.get(v) || 0) + 1);
    let best = null, most = 0;
    for (const v of vals) if (v != null && n.get(v) > most) { best = v; most = n.get(v); }
    return best;
  };
  const named = list.filter((p) => p.item).sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
  const out = { ...byRich[0], item: named ? named.item : null, confidence: named ? named.confidence : 0,
    suggestions: named ? [] : byRich[0].suggestions || [] };
  out.upgrades = vote(byRich.map((p) => p.upgrades));
  out.left = vote(byRich.map((p) => p.left));
  const keys = new Set(list.flatMap((p) => Object.keys(p.stats)));
  out.stats = {};
  for (const k of keys) {
    const seen = byRich.map((p) => p.stats[k]).filter(Boolean);
    const key = vote(seen.map((v) => `${v.total}|${v.base}|${v.gain}`));
    const [total, base, gain] = key.split("|").map(Number);
    out.stats[k] = { total, base, gain };
  }
  return out;
}

// file: an image the user picked or took. parse(text) -> parsed reading. onProgress(0..1, label).
// Reads the picture up to three ways and combines the readings: { text, parsed }.
export async function readImage(file, parse, onProgress = () => {}) {
  onProgress(0.02, "Loading the text reader…");
  const T = await loadTesseract();
  const passes = ["auto", "text", "sharp"];
  let best = null;
  const readings = [];
  for (let i = 0; i < passes.length; i++) {
    const canvas = await prepare(file, passes[i]);
    const res = await T.recognize(canvas, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") onProgress((i + m.progress) / passes.length, i ? "Trying again for a clearer read…" : "Reading the item…");
        else if (!i && typeof m.progress === "number") onProgress(0.02 + 0.1 * m.progress, "Loading the text reader…");
      },
    });
    const text = res.data.text || "";
    const parsed = parse(text);
    readings.push(parsed);
    if (!best || richness(parsed) > richness(best.parsed)) best = { text, parsed };
    // a clean read on the first pass: stop early; otherwise read all three ways and let them vote
    if (i === 0 && parsed.item && parsed.confidence >= 0.95 && Object.keys(parsed.stats).length && parsed.left != null && parsed.upgrades != null) break;
  }
  onProgress(1, "Done");
  return { text: best.text, parsed: mergeReadings(readings) };
}
