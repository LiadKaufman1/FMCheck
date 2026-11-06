// FMCheck's small server: the static site, plus /api/sales for reported sales.
//
// Reports are stored in Workers KV (binding SALES). Nothing personal is kept: no names, no accounts, no IP addresses.
// To limit spam, each visitor's IP is turned into a one-way hash that lives for a day.
//
//   POST /api/sales            { item, price, kind: "sold"|"bought", gained, left, slots, scrolls, estimate } -> { ok }
//   GET  /api/sales?item=ID    the latest reports for one item (newest first)
//   GET  /api/sales/all        every report (for calibrating the formula), paged with ?cursor=
//   GET  /api/health           { ok, sales: true|false }

const MAX_PER_DAY = 20; // reports per visitor per day

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // the backup addresses (GitHub Pages) call fmcheck.org's API
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  },
});

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// Keep only what's expected, with sane limits.
function clean(body) {
  const item = int(body.item, 1000000, 1999999);
  const price = num(body.price, 1, 1e11);
  const kind = body.kind === "sold" || body.kind === "bought" ? body.kind : null;
  if (!item || !price || !kind) return null;
  const stats = {};
  for (const [k, v] of Object.entries(body.gained || {}).slice(0, 20)) {
    if (/^[A-Za-z]{2,6}$/.test(k) && int(v, -50, 500) != null) stats[k] = v;
  }
  const scrolls = (Array.isArray(body.scrolls) ? body.scrolls : []).slice(0, 10)
    .map((s) => ({ id: int(s && s.id, 2000000, 2999999), n: int(s && s.n, 0, 20) }))
    .filter((s) => s.id && s.n != null);
  const est = body.estimate && num(body.estimate.lo, 0, 1e12) != null && num(body.estimate.hi, 0, 1e12) != null
    ? { lo: Math.round(body.estimate.lo), hi: Math.round(body.estimate.hi) } : null;
  return {
    item, price: Math.round(price), kind, gained: stats, scrolls,
    left: int(body.left, 0, 20), slots: int(body.slots, 0, 20), estimate: est,
  };
}

async function hashIp(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${day}|fmcheck`));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Newest first: KV lists keys in ascending order, so store an inverted timestamp.
const keyFor = (item, t) => `sale:${item}:${String(9e15 - t).padStart(16, "0")}:${Math.random().toString(36).slice(2, 8)}`;

async function api(request, env, url) {
  if (request.method === "OPTIONS") return json({});
  if (url.pathname === "/api/health") return json({ ok: true, sales: !!env.SALES });
  if (!env.SALES) return json({ error: "Sale reports aren't set up yet." }, 503);

  if (url.pathname === "/api/sales" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
    const rec = clean(body || {});
    if (!rec) return json({ error: "Missing item, price or sold/bought." }, 400);
    const who = await hashIp(request.headers.get("cf-connecting-ip") || "unknown");
    const rlKey = `rl:${who}`;
    const count = +(await env.SALES.get(rlKey)) || 0;
    if (count >= MAX_PER_DAY) return json({ error: "Thanks! That's enough reports for today." }, 429);
    await env.SALES.put(rlKey, String(count + 1), { expirationTtl: 86400 });
    const t = Date.now();
    rec.t = t;
    // the record also goes in the key's metadata, so listing doesn't need one read per report
    await env.SALES.put(keyFor(rec.item, t), JSON.stringify(rec), { metadata: rec });
    return json({ ok: true });
  }

  if (url.pathname === "/api/sales" && request.method === "GET") {
    const item = int(+url.searchParams.get("item"), 1000000, 1999999);
    if (!item) return json({ error: "Which item?" }, 400);
    const list = await env.SALES.list({ prefix: `sale:${item}:`, limit: 20 });
    return json({ sales: list.keys.map((k) => k.metadata).filter(Boolean) });
  }

  if (url.pathname === "/api/sales/all" && request.method === "GET") {
    const list = await env.SALES.list({ prefix: "sale:", limit: 1000, cursor: url.searchParams.get("cursor") || undefined });
    return json({ sales: list.keys.map((k) => k.metadata).filter(Boolean), cursor: list.list_complete ? null : list.cursor });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
