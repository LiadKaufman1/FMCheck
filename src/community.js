// The community: Google sign-in, and players' scrolled items, shown off or for sale.
//
// Stored in D1 (binding DB). The tables are created on first use, so there's nothing to run by hand.
// Privacy: no email or Google name is stored. A user is a one-way hash of their Google account id,
// plus the in-game name they type. Sessions are random tokens in an HttpOnly cookie, stored hashed.
//
//   POST   /api/auth/google        { credential }  sign in with the token from Google's button
//   POST   /api/auth/logout
//   GET    /api/me                  { user, listings }  (user is null when signed out)
//   PUT    /api/me                  { ign }
//   DELETE /api/me                  deletes the account and all its items
//   GET    /api/listings            ?tab=sale|show|rare &q= &item= &cat= &stat=PAD &min= &left= &sort=new|rare|cheap &offset=
//   GET    /api/listings/:id
//   POST   /api/listings            a new item (from the calculator)
//   PATCH  /api/listings/:id        { price, channel, room, note, bump, status: "sold", soldPrice }
//   DELETE /api/listings/:id        owner or admin
//   POST   /api/listings/:id/verify { stats, left }  read from the game screen; must match the listing
//   POST   /api/listings/:id/flag   report a wrong or fake item

import equips from "../data/equips.json";
import scrollData from "../data/scrolls.json";

const DAY = 864e5;
const SALE_FRESH = 3 * DAY;        // a for-sale item drops off the list after 3 days without "still selling"
const MAX_ACTIVE = 40;             // items per account
const MAX_NEW_PER_DAY = 40;
const HIDE_AT_FLAGS = 3;           // reports from different players that hide an item
const SESSION_DAYS = 30;
const PAGE = 30;
const STAT_KEYS = ["STR", "DEX", "INT", "LUK", "MHP", "MMP", "PAD", "MAD", "PDD", "MDD", "ACC", "EVA", "Speed", "Jump", "CRT", "CRD"];
const equipById = new Map(equips.map((e) => [e[0], e]));
const scrollById = new Map(scrollData.map((s) => [s.id, s]));
const catOf = (e) => (Math.floor(e[0] / 10000) >= 130 ? "Weapon" : e[3]);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, ign TEXT, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS listings (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item INTEGER NOT NULL, name TEXT NOT NULL, cat TEXT NOT NULL,
     clean TEXT NOT NULL, gained TEXT NOT NULL, stats TEXT NOT NULL, scrolls TEXT NOT NULL,
     upgrades INTEGER NOT NULL, left_slots INTEGER NOT NULL, slots INTEGER NOT NULL,
     chance REAL NOT NULL, one_in REAL NOT NULL, est_lo INTEGER, est_hi INTEGER, price INTEGER,
     channel INTEGER, room INTEGER, note TEXT, verified INTEGER NOT NULL DEFAULT 0, flags INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active', created INTEGER NOT NULL, seen INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS listings_seen ON listings(status, seen)`,
  `CREATE INDEX IF NOT EXISTS listings_item ON listings(item, status)`,
  `CREATE INDEX IF NOT EXISTS listings_user ON listings(user_id)`,
  `CREATE TABLE IF NOT EXISTS flags (listing TEXT NOT NULL, who TEXT NOT NULL, PRIMARY KEY (listing, who))`,
];
let ready = null;
const setup = (env) => (ready ||= env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { ready = null; throw e; }));

// ---------- small helpers ----------

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

function statMap(obj, lo, hi) {
  const out = {};
  for (const [k, v] of Object.entries(obj && typeof obj === "object" ? obj : {})) {
    if (STAT_KEYS.includes(k) && int(v, lo, hi) != null && v !== 0) out[k] = v;
  }
  return out;
}
const cleanText = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);
const validIgn = (s) => (/^[A-Za-z0-9]{2,13}$/.test(String(s || "")) ? String(s) : null);

// ---------- Google sign-in (verify the ID token from Google's button) ----------

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
let jwks = null, jwksUntil = 0;
async function googleKey(kid, fresh) {
  if (!jwks || fresh || Date.now() > jwksUntil) {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    jwks = (await r.json()).keys || [];
    const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
    jwksUntil = Date.now() + (m ? +m[1] * 1000 : 3600e3);
  }
  return jwks.find((k) => k.kid === kid);
}
async function verifyGoogle(token, clientId) {
  const [h, p, s] = String(token || "").split(".");
  if (!h || !p || !s) return null;
  const dec = (x) => JSON.parse(new TextDecoder().decode(b64u(x)));
  const head = dec(h), body = dec(p);
  if (head.alg !== "RS256") return null;
  const jwk = (await googleKey(head.kid)) || (await googleKey(head.kid, true));
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), enc.encode(`${h}.${p}`)))) return null;
  if (body.aud !== clientId) return null;
  if (body.iss !== "accounts.google.com" && body.iss !== "https://accounts.google.com") return null;
  if (!(body.exp * 1000 > Date.now())) return null;
  return body;
}

const COOKIE = "fmc_s";
const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
async function currentUser(req, env) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`).exec(req.headers.get("cookie") || "");
  if (!m) return null;
  return env.DB.prepare(`SELECT u.id, u.ign FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?`)
    .bind(await sha(m[1]), Date.now()).first();
}
const isAdmin = (env, user) => !!user && String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).includes(user.id);

// ---------- listings ----------

const COLS = `l.id, l.item, l.name, l.cat, l.clean, l.gained, l.stats, l.scrolls, l.upgrades, l.left_slots, l.slots, l.chance, l.one_in,
  l.est_lo, l.est_hi, l.price, l.channel, l.room, l.note, l.verified, l.status, l.created, l.seen, l.user_id, u.ign`;
function publicListing(r, user) {
  return {
    id: r.id, item: r.item, name: r.name, cat: r.cat, clean: parse(r.clean, {}), gained: parse(r.gained, {}), stats: parse(r.stats, {}),
    scrolls: parse(r.scrolls, []), upgrades: r.upgrades, left: r.left_slots, slots: r.slots, chance: r.chance, oneIn: r.one_in,
    estimate: r.est_lo != null ? { lo: r.est_lo, hi: r.est_hi } : null, price: r.price, ign: r.ign, channel: r.channel, room: r.room,
    note: r.note, verified: !!r.verified, status: r.status, created: r.created, seen: r.seen, mine: !!user && user.id === r.user_id,
  };
}

// The item as the calculator sent it, checked against the game data.
function readListing(b) {
  const e = equipById.get(b.item);
  if (!e) return { error: "Unknown item." };
  const slots = e[4];
  const left = int(b.left, 0, slots);
  if (left == null) return { error: "Slots left doesn't fit this item." };
  const clean = statMap(b.clean, -50, 2000);
  const scrolls = (Array.isArray(b.scrolls) ? b.scrolls : []).slice(0, 10)
    .map((s) => ({ id: s && s.id, n: int(s && s.n, 0, slots) }))
    .filter((s) => s.n != null && scrollById.has(s.id) && scrollById.get(s.id).target === Math.floor(e[0] / 10000));
  const upgrades = scrolls.reduce((a, s) => a + s.n, 0);
  if (upgrades > slots - left) return { error: "More passed scrolls than used slots." };
  // what the scrolls added, worked out here from the game data rather than trusted from the page
  const gained = {};
  for (const s of scrolls) for (const [k, v] of Object.entries(scrollById.get(s.id).stats)) gained[k] = (gained[k] || 0) + v * s.n;
  const stats = {};
  for (const k of new Set([...Object.keys(clean), ...Object.keys(gained)])) {
    const v = (clean[k] || 0) + (gained[k] || 0);
    if (v) stats[k] = v;
  }
  const chance = num(b.chance, 0, 1) ?? 1;
  const est = b.estimate && num(b.estimate.lo, 0, 1e12) != null && num(b.estimate.hi, 0, 1e12) != null
    ? { lo: Math.round(b.estimate.lo), hi: Math.round(b.estimate.hi) } : null;
  return {
    item: e[0], name: e[1], cat: catOf(e), clean, gained: statMap(gained, -500, 5000), stats, scrolls, upgrades, left, slots,
    chance, oneIn: chance > 0 ? Math.min(1 / chance, 1e15) : 1e15, est,
  };
}
// The seller's part: price (empty = just showing it off) and where to find them.
function readSeller(b) {
  const out = {};
  if ("price" in b) out.price = b.price == null || b.price === "" ? null : int(Math.round(+b.price), 1, 1e11);
  if ("channel" in b) out.channel = b.channel == null || b.channel === "" ? null : int(+b.channel, 1, 40);
  if ("room" in b) out.room = b.room == null || b.room === "" ? null : int(+b.room, 1, 30);
  if ("note" in b) out.note = cleanText(b.note, 140) || null;
  return out;
}

async function discordPost(env, l, ign, image, origin) {
  if (!env.DISCORD_WEBHOOK) return;
  const min = +(env.DISCORD_MIN_ONE_IN || 50);
  if (l.oneIn < min) return;
  const lines = Object.entries(l.gained).map(([k, v]) => `+${v} ${k}`).join(", ");
  const oneIn = l.oneIn < 1e6 ? Math.round(l.oneIn).toLocaleString("en-US") : l.oneIn.toExponential(1);
  const link = `${origin}/community.html#l=${l.id}`;
  const embed = {
    title: `${l.name}${l.upgrades ? ` (+${l.upgrades})` : ""}`, url: link,
    description: [lines && `**${lines}**`, `${l.left} slot${l.left === 1 ? "" : "s"} left · 1 in ${oneIn}`,
      l.price ? `For sale: **${fmtMesos(l.price)}** by ${ign}` : `Shown off by ${ign}`].filter(Boolean).join("\n"),
    color: 0xffb83d,
  };
  const payload = { username: "FMCheck", content: "✨ A rare item was just added", embeds: [embed], allowed_mentions: { parse: [] } };
  let body, headers = {};
  const png = typeof image === "string" && image.startsWith("data:image/png;base64,") && image.length < 600000 ? image.slice(22) : null;
  if (png) {
    embed.image = { url: "attachment://card.png" };
    body = new FormData();
    body.append("payload_json", JSON.stringify(payload));
    body.append("files[0]", new Blob([b64u(png)], { type: "image/png" }), "card.png");
  } else {
    body = JSON.stringify(payload);
    headers = { "content-type": "application/json" };
  }
  await fetch(env.DISCORD_WEBHOOK, { method: "POST", body, headers }).catch(() => {});
}
const fmtMesos = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));

// ---------- routes ----------

export const communityReady = (env) => !!(env.DB && env.GOOGLE_CLIENT_ID);

export async function community(request, env, ctx, url, json, saveSale) {
  if (!communityReady(env)) return json({ error: "The community isn't set up yet." }, 503);
  await setup(env);
  const { pathname: path } = url;
  const method = request.method;
  // Changes only from the site itself (with the sign-in cookie), never from other sites.
  if (method !== "GET" && request.headers.get("origin") !== url.origin) return json({ error: "Not allowed." }, 403);
  const user = await currentUser(request, env);
  const body = method === "POST" || method === "PUT" || method === "PATCH" ? await request.json().catch(() => ({})) || {} : {};
  const needUser = () => (user ? null : json({ error: "Sign in first." }, 401));

  if (path === "/api/auth/google" && method === "POST") {
    const g = await verifyGoogle(body.credential, env.GOOGLE_CLIENT_ID).catch(() => null);
    if (!g || !g.sub) return json({ error: "Google sign-in failed. Try again." }, 401);
    const id = (await sha(`google:${g.sub}|fmcheck`)).slice(0, 32);
    const token = randomHex(32);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO users (id, ign, created) VALUES (?, NULL, ?)`).bind(id, now),
      env.DB.prepare(`INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)`).bind(await sha(token), id, now + SESSION_DAYS * DAY),
      env.DB.prepare(`DELETE FROM sessions WHERE expires < ?`).bind(now),
    ]);
    const u = await env.DB.prepare(`SELECT id, ign FROM users WHERE id = ?`).bind(id).first();
    return json({ user: u }, 200, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
  }
  // Local testing only (wrangler dev with DEV_LOGIN=1): sign in without Google. Never set on the real site.
  if (path === "/api/auth/dev" && method === "POST" && env.DEV_LOGIN === "1") {
    const id = (await sha(`dev:${body.name}`)).slice(0, 32), token = randomHex(32), now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO users (id, ign, created) VALUES (?, NULL, ?)`).bind(id, now),
      env.DB.prepare(`INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)`).bind(await sha(token), id, now + DAY),
    ]);
    return json({ user: { id, ign: null } }, 200, { "set-cookie": sessionCookie(token, 86400) });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`).exec(request.headers.get("cookie") || "");
    if (m) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(await sha(m[1])).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }

  if (path === "/api/me") {
    if (method === "GET") {
      if (!user) return json({ user: null, listings: [] });
      const rows = await env.DB.prepare(`SELECT ${COLS} FROM listings l JOIN users u ON u.id = l.user_id WHERE l.user_id = ? ORDER BY l.created DESC`)
        .bind(user.id).all();
      return json({ user, admin: isAdmin(env, user), listings: rows.results.map((r) => publicListing(r, user)) });
    }
    if (needUser()) return needUser();
    if (method === "PUT") {
      const ign = validIgn(body.ign);
      if (!ign) return json({ error: "In-game name: 2–13 letters or numbers." }, 400);
      await env.DB.prepare(`UPDATE users SET ign = ? WHERE id = ?`).bind(ign, user.id).run();
      return json({ user: { ...user, ign } });
    }
    if (method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM flags WHERE who = ? OR listing IN (SELECT id FROM listings WHERE user_id = ?)`).bind(user.id, user.id),
        env.DB.prepare(`DELETE FROM listings WHERE user_id = ?`).bind(user.id),
        env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user.id),
        env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id),
      ]);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
    }
  }

  if (path === "/api/listings" && method === "GET") {
    const p = url.searchParams;
    const where = [`l.status = 'active'`, `l.flags < ${HIDE_AT_FLAGS}`];
    const args = [];
    const now = Date.now();
    const tab = p.get("tab") || "sale";
    if (tab === "sale") { where.push(`l.price IS NOT NULL`, `l.seen > ?`); args.push(now - SALE_FRESH); }
    else if (tab === "show") where.push(`l.price IS NULL`);
    else if (tab === "rare") { where.push(`l.created > ?`); args.push(now - 7 * DAY); }
    const q = cleanText(p.get("q"), 40);
    if (q) { where.push(`l.name LIKE ? ESCAPE '\\'`); args.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`); }
    const item = int(+p.get("item"), 1000000, 1999999);
    if (item) { where.push(`l.item = ?`); args.push(item); }
    const cat = cleanText(p.get("cat"), 30);
    if (cat) { where.push(`l.cat = ?`); args.push(cat); }
    const stat = p.get("stat"), min = +p.get("min");
    if (STAT_KEYS.includes(stat) && Number.isFinite(min) && p.get("min") !== "") {
      where.push(`COALESCE(json_extract(l.stats, ?), 0) >= ?`); args.push(`$.${stat}`, min);
    }
    const left = int(+p.get("left"), 1, 20);
    if (left) { where.push(`l.left_slots >= ?`); args.push(left); }
    if (p.get("verified") === "1") where.push(`l.verified = 1`);
    const sort = tab === "rare" ? "rare" : p.get("sort");
    const order = sort === "rare" ? `l.one_in DESC` : sort === "cheap" ? `l.price ASC` : sort === "pricey" ? `l.price DESC` : `l.seen DESC`;
    const offset = int(+p.get("offset"), 0, 10000) || 0;
    const rows = await env.DB.prepare(`SELECT ${COLS} FROM listings l JOIN users u ON u.id = l.user_id WHERE ${where.join(" AND ")}
      ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${offset}`).bind(...args).all();
    const list = rows.results.slice(0, PAGE).map((r) => publicListing(r, user));
    return json({ listings: list, more: rows.results.length > PAGE });
  }

  if (path === "/api/listings" && method === "POST") {
    if (needUser()) return needUser();
    if (!user.ign) return json({ error: "Add your in-game name first." }, 400);
    const l = readListing(body);
    if (l.error) return json({ error: l.error }, 400);
    const s = readSeller(body);
    const counts = await env.DB.prepare(`SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN created > ? THEN 1 ELSE 0 END) AS today
        FROM listings WHERE user_id = ?`).bind(Date.now() - DAY, user.id).first();
    if ((counts.active || 0) >= MAX_ACTIVE) return json({ error: `You have ${MAX_ACTIVE} items up. Remove one first.` }, 429);
    if ((counts.today || 0) >= MAX_NEW_PER_DAY) return json({ error: "That's enough new items for today." }, 429);
    const id = randomHex(6);
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO listings (id, user_id, item, name, cat, clean, gained, stats, scrolls, upgrades, left_slots, slots,
        chance, one_in, est_lo, est_hi, price, channel, room, note, created, seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.id, l.item, l.name, l.cat, JSON.stringify(l.clean), JSON.stringify(l.gained), JSON.stringify(l.stats),
        JSON.stringify(l.scrolls), l.upgrades, l.left, l.slots, l.chance, l.oneIn, l.est?.lo ?? null, l.est?.hi ?? null,
        s.price ?? null, s.channel ?? null, s.room ?? null, s.note ?? null, now, now).run();
    ctx.waitUntil(discordPost(env, { ...l, id, price: s.price }, user.ign, body.image, url.origin));
    return json({ id });
  }

  const m = /^\/api\/listings\/([a-f0-9]{12})(\/verify|\/flag)?$/.exec(path);
  if (m) {
    const [, id, action] = m;
    const row = await env.DB.prepare(`SELECT ${COLS} FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`).bind(id).first();
    if (!row) return json({ error: "This item isn't listed anymore." }, 404);
    const mine = !!user && row.user_id === user.id;

    if (!action && method === "GET") return json({ listing: publicListing(row, user) });

    if (action === "/flag" && method === "POST") {
      if (needUser()) return needUser();
      if (mine) return json({ error: "That's your own item." }, 400);
      await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO flags (listing, who) VALUES (?, ?)`).bind(id, user.id),
        env.DB.prepare(`UPDATE listings SET flags = (SELECT COUNT(*) FROM flags WHERE listing = ?) WHERE id = ?`).bind(id, id),
      ]);
      return json({ ok: true });
    }

    if (!mine && !(method === "DELETE" && isAdmin(env, user))) return json({ error: user ? "Not your item." : "Sign in first." }, user ? 403 : 401);

    if (action === "/verify" && method === "POST") {
      // What the page read off the game's item window must match the listing exactly.
      const read = statMap(body.stats, -50, 5000);
      const want = parse(row.stats, {});
      const ok = Object.keys(want).length > 0 && Object.entries(want).every(([k, v]) => read[k] === v) && int(body.left, 0, 20) === row.left_slots;
      if (!ok) return json({ error: "The stats on screen don't match this item." }, 400);
      await env.DB.prepare(`UPDATE listings SET verified = 1, seen = ? WHERE id = ?`).bind(Date.now(), id).run();
      return json({ ok: true });
    }

    if (!action && method === "PATCH") {
      const s = readSeller(body);
      const sets = [], args = [];
      for (const [k, v] of Object.entries(s)) { sets.push(`${k} = ?`); args.push(v); }
      if (body.bump || Object.keys(s).length) { sets.push(`seen = ?`); args.push(Date.now()); }
      let sale = null;
      if (body.status === "sold") {
        sets.push(`status = 'sold'`);
        const sold = int(Math.round(+body.soldPrice), 1, 1e11);
        if (sold) {
          sale = { item: row.item, price: sold, kind: "sold", gained: parse(row.gained, {}), left: row.left_slots, slots: row.slots,
            scrolls: parse(row.scrolls, []), estimate: row.est_lo != null ? { lo: row.est_lo, hi: row.est_hi } : null };
        }
      } else if (body.status === "active") sets.push(`status = 'active'`);
      if (!sets.length) return json({ error: "Nothing to change." }, 400);
      await env.DB.prepare(`UPDATE listings SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
      if (sale && saveSale) await saveSale(sale);
      const fresh = await env.DB.prepare(`SELECT ${COLS} FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`).bind(id).first();
      return json({ listing: publicListing(fresh, user) });
    }

    if (!action && method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM flags WHERE listing = ?`).bind(id),
        env.DB.prepare(`DELETE FROM listings WHERE id = ?`).bind(id),
      ]);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}
