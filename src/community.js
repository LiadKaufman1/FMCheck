// The community: Google sign-in, and players' scrolled items for sale.
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
//   GET    /api/listings            ?tab=sale|show|rare &q= &item= &cat= &job= &stat=PAD &min= &left= &sort=new|rare|cheap &offset=
//   GET    /api/listings/cats       how many items each category has, for the same tab and filters
//   GET    /api/listings/:id
//   POST   /api/listings            a new item (from the calculator)
//   PATCH  /api/listings/:id        { price, channel, room, note, bump, status: "sold" }
//   DELETE /api/listings/:id        owner or admin
//   POST   /api/listings/:id/verify { stats, left }  read from the game screen; must match the listing
//   POST   /api/listings/:id/flag   report a wrong or fake item
//   POST   /api/listings/:id/boost  supporters: "Featured" at the top for 24 hours
//   POST   /api/me/claim            { email }  link a Ko-fi payment made with that email
//   POST   /api/kofi                Ko-fi's webhook (form field "data", checked with KOFI_TOKEN):
//                                    a membership payment adds supporter days; a one-off payment buys extra boosts
//   POST   /api/admin/supporter     { code, days }  admins: give supporter time by hand
//   GET    /api/prices              FMCheck's price list: average prices of scrolls and clean items, kept by hand by admins
//   PUT    /api/prices              { prices: { id: price | null } }  admins: set or remove prices
//   POST   /api/prices/report       { prices: { id: price } }  prices players typed on Sell an item (anonymous).
//                                    With 3+ different players in 30 days, their median goes in the list (admin prices win).
//
// Supporters (Ko-fi membership): a badge, more items, items stay on the for-sale list longer,
// and a few boosts a month. Ko-fi sends the payer's email; only a one-way hash of it is kept, to match renewals.

import equips from "../data/equips.json";
import scrollData from "../data/scrolls.json";
import { statRange, rollAtLeast, groupOdds, allocateFailures } from "../js/calc.js";
import demoItems from "./demo.json";
import priceSeed from "./prices-seed.json";

const DAY = 864e5;
const SALE_FRESH = 3 * DAY;        // a for-sale item drops off the list after 3 days without "still selling"
const SALE_FRESH_SUPPORTER = 7 * DAY;
const MAX_ACTIVE = 3;              // items up at once per account
const MAX_ACTIVE_SUPPORTER = 10;
const BOOSTS_PER_MONTH = 2;        // supporters: 24 hours as "Featured", per 30 days
// Extra boosts: one-off Ko-fi payments, BOOST_PRICE dollars each (default $1), for supporters who used their monthly ones.
const BOOST_HOURS = 24;
const MAX_FEATURED = 6;            // Featured spots at once, so it stays special
const SUPPORT_DAYS = 31;           // what one monthly payment gives
const MAX_NEW_PER_DAY = 4;         // new items a day, counting ones removed again (so delete + re-post can't be used to bump)
const MAX_NEW_PER_DAY_SUPPORTER = 20;
const REPOST_DAYS = 5;             // the same item posted again within this time keeps its first date (no jumping to the top)
const MAX_FEATURED_PER_USER = 2;   // so one player can't take every Featured spot
const FLAG_MIN_AGE = 3 * DAY;      // reports count only from accounts this old, with an in-game name
// Example items (src/demo.json, made by scripts/make_demo.py) fill the page while it's new. They're marked "Example",
// rank below real items, are never posted or featured for real, and stop showing once DEMO_UNTIL real items are up.
// Setting DEMO=off hides them at once.
const DEMO_UNTIL = 30;
const CROWD_MIN = 3;     // different players (per day) before their typed price goes in the list
const CROWD_DAYS = 30;   // typed prices older than this are dropped
const HIDE_AT_FLAGS = 3;           // reports from different players that hide an item
const SESSION_DAYS = 30;
const PAGE = 30;
const STAT_KEYS = ["STR", "DEX", "INT", "LUK", "MHP", "MMP", "PAD", "MAD", "PDD", "MDD", "ACC", "EVA", "Speed", "Jump", "CRT", "CRD"];
const equipById = new Map(equips.map((e) => [e[0], e]));
const scrollById = new Map(scrollData.map((s) => [s.id, s]));
const catOf = (e) => (Math.floor(e[0] / 10000) >= 130 ? "Weapon" : e[3]);
// item ids each class can wear, for the class filter (numbers from the game data, safe to put in SQL)
const JOB_ITEMS = Object.fromEntries(["Beginner", "Warrior", "Magician", "Bowman", "Thief"].map((j) =>
  [j, equips.filter((e) => !(e[6] && e[6].jobs) || e[6].jobs.includes(j)).map((e) => e[0]).join(",")]));

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
  `CREATE TABLE IF NOT EXISTS boosts (user_id TEXT NOT NULL, listing TEXT NOT NULL, t INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS boosts_user ON boosts(user_id, t)`,
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, email_hash TEXT, t INTEGER NOT NULL, days INTEGER NOT NULL, user_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS boost_credits (user_id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS posts (user_id TEXT NOT NULL, fp TEXT NOT NULL, created INTEGER NOT NULL, t INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id, t)`,
  `CREATE INDEX IF NOT EXISTS users_ign ON users(ign COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS site_prices (id INTEGER PRIMARY KEY, price INTEGER NOT NULL, t INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS price_reports (id INTEGER NOT NULL, who TEXT NOT NULL, price INTEGER NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (id, who))`,
  `CREATE INDEX IF NOT EXISTS price_reports_t ON price_reports(t)`,
  `CREATE INDEX IF NOT EXISTS payments_email ON payments(email_hash)`,
];
// Columns added after the first version: added to existing tables when missing.
const COLUMNS = {
  users: [["supporter_until", "INTEGER NOT NULL DEFAULT 0"], ["sup_code", "TEXT"], ["sup_email", "TEXT"]],
  listings: [["featured_until", "INTEGER NOT NULL DEFAULT 0"], ["demo", "INTEGER NOT NULL DEFAULT 0"], ["demo_seller", "TEXT"]],
  payments: [["boosts", "INTEGER NOT NULL DEFAULT 0"]],
  boosts: [["paid", "INTEGER NOT NULL DEFAULT 0"]],
};
async function migrate(env) {
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set((await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name));
    for (const [name, type] of cols) if (!have.has(name)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
  }
  await seedDemo(env);
  await seedPrices(env);
}

// Puts the example items in once. For examples, created and seen hold "how long ago" (ms), so they always look recent.
async function seedDemo(env) {
  if (env.DEMO === "off") return;
  const done = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'demo'`).first();
  if (done) return;
  const q = [];
  const sellers = new Map();
  for (const [i, d] of demoItems.entries()) {
    const l = readListing(d);
    if (l.error) { console.warn("example item skipped:", d.item, l.error); continue; }
    const uid = `demo-${d.seller.toLowerCase()}`;
    if (!sellers.has(uid)) {
      sellers.set(uid, true);
      q.push(env.DB.prepare(`INSERT OR IGNORE INTO users (id, ign, created, supporter_until) VALUES (?, NULL, 0, ?)`)
        .bind(uid, d.supporter ? 4102444800000 : 0));
    }
    q.push(env.DB.prepare(`INSERT OR IGNORE INTO listings (id, user_id, item, name, cat, clean, gained, stats, scrolls, upgrades,
        left_slots, slots, chance, one_in, est_lo, est_hi, price, channel, room, note, verified, created, seen, demo, demo_seller)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`de${String(i).padStart(10, "0")}`, uid, l.item, l.name, l.cat, JSON.stringify(l.clean), JSON.stringify(l.gained),
        JSON.stringify(l.stats), JSON.stringify(l.scrolls), l.upgrades, l.left, l.slots, l.chance, l.oneIn,
        d.estimate?.lo ?? null, d.estimate?.hi ?? null, d.price ?? null, d.channel ?? null, d.room ?? null, d.note ?? null,
        d.verified ? 1 : 0, d.minutesAgo * 60000, d.seenAgo * 60000, d.featured ? 2 : 1, d.seller));
  }
  q.push(env.DB.prepare(`INSERT OR REPLACE INTO meta (k, v) VALUES ('demo', ?)`).bind(String(Date.now())));
  await env.DB.batch(q);
}

// Price list data shipped with the site (src/prices-seed.json): each version goes in once. A price is replaced only
// if it's older than the data (so prices admins set later on admin.html are kept). After that, admins keep the list.
async function seedPrices(env) {
  const key = `prices_seed:${priceSeed.date}`;
  const done = await env.DB.prepare(`SELECT v FROM meta WHERE k = ?`).bind(key).first();
  if (done) return;
  const t = Date.parse(priceSeed.date) || Date.now();
  // prices from an earlier version that must come out (marked by the time they were put in)
  const drop = (priceSeed.drop_t || []).map((d) => Date.parse(d)).filter(Number.isFinite)
    .map((dt) => env.DB.prepare(`DELETE FROM site_prices WHERE t = ?`).bind(dt));
  const q = [...drop, ...Object.entries(priceSeed.prices).map(([id, price]) =>
    env.DB.prepare(`INSERT INTO site_prices (id, price, t) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET price = excluded.price, t = excluded.t WHERE site_prices.t < excluded.t`).bind(+id, price, t))];
  q.push(env.DB.prepare(`INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)`).bind(key, String(Date.now())));
  for (let i = 0; i < q.length; i += 90) await env.DB.batch(q.slice(i, i + 90));
}

// Show the examples? Until enough real items are up (checked at most every 5 minutes).
let demoCheck = { at: 0, on: true };
async function demoOn(env) {
  if (env.DEMO === "off") return false;
  if (Date.now() - demoCheck.at < 5 * 60e3) return demoCheck.on;
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM listings WHERE demo = 0 AND status = 'active'`).first();
  demoCheck = { at: Date.now(), on: (r.n || 0) < DEMO_UNTIL };
  return demoCheck.on;
}
let ready = null;
const setup = (env) => (ready ||= migrate(env).catch((e) => { ready = null; throw e; }));

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
  return env.DB.prepare(`SELECT u.id, u.ign, u.supporter_until, u.sup_code, u.created FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?`)
    .bind(await sha(m[1]), Date.now()).first();
}
const isAdmin = (env, user) => !!user && String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).includes(user.id);

// ---------- listings ----------

const COLS = `l.id, l.item, l.name, l.cat, l.clean, l.gained, l.stats, l.scrolls, l.upgrades, l.left_slots, l.slots, l.chance, l.one_in,
  l.est_lo, l.est_hi, l.price, l.channel, l.room, l.note, l.verified, l.status, l.created, l.seen, l.featured_until, l.user_id, u.ign,
  l.demo, l.demo_seller,
  u.supporter_until`;
function publicListing(r, user) {
  const now = Date.now();
  if (r.demo) {
    r = { ...r, ign: r.demo_seller, created: now - r.created, seen: now - r.seen, featured_until: r.demo === 2 ? now + 6 * 3600e3 : 0 };
  }
  return {
    demo: !!r.demo,
    id: r.id, item: r.item, name: r.name, cat: r.cat, clean: parse(r.clean, {}), gained: parse(r.gained, {}), stats: parse(r.stats, {}),
    scrolls: parse(r.scrolls, []), upgrades: r.upgrades, left: r.left_slots, slots: r.slots, chance: r.chance, oneIn: r.one_in,
    estimate: r.est_lo != null ? { lo: r.est_lo, hi: r.est_hi } : null, price: r.price, ign: r.ign, channel: r.channel, room: r.room,
    note: r.note, verified: !!r.verified, status: r.status, created: r.created, seen: r.seen, mine: !!user && user.id === r.user_id,
    supporter: r.supporter_until > Date.now(), featured: r.featured_until > Date.now() ? r.featured_until : 0,
  };
}

// The item as the calculator sent it, checked against the game data.
function readListing(b) {
  const e = equipById.get(b.item);
  if (!e) return { error: "Unknown item." };
  const slots = e[4];
  const left = int(b.left, 0, slots);
  if (left == null) return { error: "Slots left doesn't fit this item." };
  // Clean stats: each one the item has, within what a drop can roll (anything else is ignored).
  const base = e[5] || {};
  const clean = {};
  for (const [k, v] of Object.entries(base)) {
    const [lo, hi] = statRange(k, v);
    const want = b.clean && Number.isInteger(b.clean[k]) ? b.clean[k] : v;
    if (want < lo || want > hi) return { error: `Clean ${k} can't be ${want} on this item (${lo}–${hi}).` };
    if (want) clean[k] = want;
  }
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
  // The chance of an item like this, worked out here the same way as the calculator (the page's number isn't trusted).
  const key = keyStat(e[0], base);
  const roll = key ? rollAtLeast(key, base[key], clean[key] || 0) : 1;
  const types = scrolls.map((s) => ({ successes: s.n, success: scrollById.get(s.id).success, boom: scrollById.get(s.id).boom }));
  const fails = allocateFailures(types, slots - left - upgrades);
  const chance = types.reduce((c, t, i) => c * groupOdds(t.successes + fails[i], t.successes, t.success, t.boom), roll);
  const est = b.estimate && num(b.estimate.lo, 0, 1e12) != null && num(b.estimate.hi, 0, 1e12) != null
    ? { lo: Math.round(b.estimate.lo), hi: Math.round(b.estimate.hi) } : null;
  return {
    item: e[0], name: e[1], cat: catOf(e), clean, gained: statMap(gained, -500, 5000), stats, scrolls, upgrades, left, slots,
    chance, oneIn: chance > 0 ? Math.min(1 / chance, 1e15) : 1e15, est,
  };
}
// Same rule as the calculator: the stat a clean drop's rarity is measured by.
function keyStat(id, base) {
  if (Math.floor(id / 10000) >= 130) return (base.MAD || 0) > (base.PAD || 0) ? "MAD" : (base.PAD ? "PAD" : "");
  return ["PAD", "MAD", "STR", "DEX", "INT", "LUK", "ACC", "EVA", "Speed", "Jump"].find((k) => base[k])
    || STAT_KEYS.find((k) => base[k]) || "";
}
// One item as a seller has it: same item, same stats, same slots left.
const fingerprint = (l) => sha(`${l.item}|${JSON.stringify(Object.entries(l.stats).sort())}|${l.left}`);

// The seller's part: the asking price (required) and where to find them.
function readSeller(b) {
  const out = {};
  if ("price" in b) out.price = int(Math.round(+b.price), 1, 1e11);
  if ("channel" in b) out.channel = b.channel == null || b.channel === "" ? null : int(+b.channel, 1, 40);
  if ("room" in b) out.room = b.room == null || b.room === "" ? null : int(+b.room, 1, 30);
  if ("note" in b) out.note = cleanText(b.note, 140) || null;
  return out;
}

async function discordPost(env, l, ign, image, origin, featured = false) {
  if (!env.DISCORD_WEBHOOK) return;
  const min = +(env.DISCORD_MIN_ONE_IN || 50);
  if (!featured && l.oneIn < min) return;
  const lines = Object.entries(l.gained).map(([k, v]) => `+${v} ${k}`).join(", ");
  const oneIn = l.oneIn < 1e6 ? Math.round(l.oneIn).toLocaleString("en-US") : l.oneIn.toExponential(1);
  const link = `${origin}/community.html#l=${l.id}`;
  const embed = {
    title: `${l.name}${l.upgrades ? ` (+${l.upgrades})` : ""}`, url: link,
    description: [lines && `**${lines}**`, `${l.left} slot${l.left === 1 ? "" : "s"} left · 1 in ${oneIn}`,
      `For sale: **${fmtMesos(l.price)}** by ${ign}`].filter(Boolean).join("\n"),
    color: 0xffb83d,
  };
  if (featured) embed.thumbnail = { url: `${origin}/assets/items/${String(l.item).padStart(8, "0")}.png` };
  const payload = { username: "FMCheck", content: featured ? "⭐ Featured by a supporter" : "✨ A rare item was just added",
    embeds: [embed], allowed_mentions: { parse: [] } };
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

// ---------- supporters ----------

const isSupporter = (u) => !!u && u.supporter_until > Date.now();
const emailHash = (email) => sha(`${String(email || "").trim().toLowerCase()}|fmcheck-kofi`);
const newCode = () => `FMC-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("")}`;

// Adds supporter days to a user, starting from today or from the end of their current time.
const extend = (env, userId, days, now = Date.now()) => env.DB.prepare(
  `UPDATE users SET supporter_until = MAX(supporter_until, ?) + ? WHERE id = ?`).bind(now, days * DAY, userId);

// Monthly boosts left (used ones come back 30 days later) and bought extra boosts (they don't run out).
async function boostInfo(env, user) {
  const [used, extra] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM boosts WHERE user_id = ? AND t > ? AND paid = 0`).bind(user.id, Date.now() - 30 * DAY).first(),
    env.DB.prepare(`SELECT n FROM boost_credits WHERE user_id = ?`).bind(user.id).first(),
  ]);
  const monthly = isSupporter(user) ? Math.max(0, BOOSTS_PER_MONTH - (used.n || 0)) : 0;
  return { monthly, extra: extra ? extra.n : 0 };
}
async function boostsLeft(env, user) {
  if (!isSupporter(user)) return 0;
  const b = await boostInfo(env, user);
  return b.monthly + b.extra;
}
const addCredits = (env, userId, n) => env.DB.prepare(
  `INSERT INTO boost_credits (user_id, n) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET n = n + excluded.n`).bind(userId, n);

async function meInfo(env, user) {
  let code = user.sup_code;
  if (!code) {
    code = newCode();
    await env.DB.prepare(`UPDATE users SET sup_code = ? WHERE id = ?`).bind(code, user.id).run();
  }
  const b = await boostInfo(env, user);
  return { id: user.id, ign: user.ign, supporter: isSupporter(user), supporterUntil: user.supporter_until || 0, code,
    boostsLeft: isSupporter(user) ? b.monthly + b.extra : 0, monthlyLeft: b.monthly, extraBoosts: b.extra, perMonth: BOOSTS_PER_MONTH,
    maxItems: isSupporter(user) ? MAX_ACTIVE_SUPPORTER : MAX_ACTIVE };
}

// Ko-fi calls this after each payment (one-off or monthly membership).
async function kofi(request, env, json) {
  if (!env.KOFI_TOKEN) return json({ error: "Not set up." }, 503);
  const form = await request.formData().catch(() => null);
  const d = parse(form && form.get("data"), null);
  if (!d || d.verification_token !== env.KOFI_TOKEN) return json({ error: "Not allowed." }, 403);
  const id = cleanText(d.kofi_transaction_id || d.message_id, 80);
  if (!id) return json({ ok: true });
  const amount = parseFloat(d.amount) || 0;
  const boostPrice = +(env.BOOST_PRICE || 1);
  // A membership payment: a month of supporter perks. A one-off payment (or shop order): extra boosts, one per BOOST_PRICE.
  const days = d.type === "Subscription" ? SUPPORT_DAYS : 0;
  const shopQty = Array.isArray(d.shop_items) ? d.shop_items.reduce((a, x) => a + (int(+x.quantity, 1, 100) || 1), 0) : 0;
  const boosts = days ? 0 : d.type === "Shop Order" && shopQty ? shopQty : Math.floor(amount / boostPrice + 1e-9);
  if (!days && !boosts) return json({ ok: true }); // a small tip: thanks, nothing to unlock
  const hash = d.email ? await emailHash(d.email) : null;
  const fresh = await env.DB.prepare(`INSERT OR IGNORE INTO payments (id, email_hash, t, days, boosts) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, hash, Date.now(), days, boosts).run();
  if (!fresh.meta.changes) return json({ ok: true }); // already counted
  // whose is it: the FMCheck code in the Ko-fi message, or the email of an earlier payment
  const code = /FMC-[A-Z0-9]{6}/i.exec(String(d.message || ""))?.[0]?.toUpperCase();
  let u = code ? await env.DB.prepare(`SELECT id FROM users WHERE sup_code = ?`).bind(code).first() : null;
  if (!u && hash) u = await env.DB.prepare(`SELECT id FROM users WHERE sup_email = ?`).bind(hash).first();
  if (u) {
    await env.DB.batch([
      ...(days ? [extend(env, u.id, days)] : []),
      ...(boosts ? [addCredits(env, u.id, boosts)] : []),
      env.DB.prepare(`UPDATE payments SET user_id = ? WHERE id = ?`).bind(u.id, id),
      ...(hash ? [env.DB.prepare(`UPDATE users SET sup_email = ? WHERE id = ?`).bind(hash, u.id)] : []),
    ]);
  }
  return json({ ok: true });
}

// Which listings a tab and its filters cover. skipCat: leave the category out (to count items per category).
function listWhere(p, now, skipCat = false, demo = false) {
  const where = [`l.status = 'active'`, `l.flags < ${HIDE_AT_FLAGS}`];
  const args = [];
  if (!demo) where.push(`l.demo = 0`);
  where.push(`l.price IS NOT NULL`); // only items for sale (old priceless "showcase" items stay hidden)
  const tab = p.get("tab") || "sale";
  if (tab === "sale") {
    where.push(`l.price IS NOT NULL`, `(l.demo > 0 OR l.seen > (CASE WHEN u.supporter_until > ? THEN ? ELSE ? END))`);
    args.push(now, now - SALE_FRESH_SUPPORTER, now - SALE_FRESH);
  }
  else if (tab === "featured") { where.push(`(l.featured_until > ? OR l.demo = 2)`); args.push(now); }
  else if (tab === "rare") { where.push(`(l.demo > 0 OR l.created > ?)`); args.push(now - 7 * DAY); }
  const q = cleanText(p.get("q"), 40);
  if (q) { where.push(`l.name LIKE ? ESCAPE '\\'`); args.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`); }
  const item = int(+p.get("item"), 1000000, 1999999);
  if (item) { where.push(`l.item = ?`); args.push(item); }
  const cat = skipCat ? "" : cleanText(p.get("cat"), 30);
  if (cat) { where.push(`l.cat = ?`); args.push(cat); }
  const stat = p.get("stat"), min = +p.get("min");
  if (STAT_KEYS.includes(stat) && Number.isFinite(min) && p.get("min") !== "") {
    where.push(`COALESCE(json_extract(l.stats, ?), 0) >= ?`); args.push(`$.${stat}`, min);
  }
  const left = int(+p.get("left"), 1, 20);
  if (left) { where.push(`l.left_slots >= ?`); args.push(left); }
  if (p.get("verified") === "1") where.push(`l.verified = 1`);
  // class: items that class can wear (items with no class limit count for every class)
  const job = p.get("job");
  if (JOB_ITEMS[job]) where.push(`l.item IN (${JOB_ITEMS[job]})`);
  return { where, args, tab };
}

// ---------- routes ----------

export const communityReady = (env) => !!(env.DB && env.GOOGLE_CLIENT_ID);

export async function community(request, env, ctx, url, json) {
  if (!communityReady(env)) return json({ error: "The Market isn't set up yet." }, 503);
  await setup(env);
  const { pathname: path } = url;
  const method = request.method;
  if (path === "/api/kofi" && method === "POST") return kofi(request, env, json);
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
      return json({ user: await meInfo(env, user), admin: isAdmin(env, user), listings: rows.results.map((r) => publicListing(r, user)) });
    }
    if (needUser()) return needUser();
    if (method === "PUT") {
      const ign = validIgn(body.ign);
      if (!ign) return json({ error: "In-game name: 2–13 letters or numbers." }, 400);
      const taken = await env.DB.prepare(`SELECT id FROM users WHERE ign = ? COLLATE NOCASE AND id != ?`).bind(ign, user.id).first();
      if (taken) return json({ error: "That in-game name is already used here. If it's your character, tell us on Discord." }, 409);
      await env.DB.prepare(`UPDATE users SET ign = ? WHERE id = ?`).bind(ign, user.id).run();
      return json({ user: await meInfo(env, { ...user, ign }) });
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

  if (path === "/api/me/claim" && method === "POST") {
    if (needUser()) return needUser();
    const email = String(body.email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter the email you used on Ko-fi." }, 400);
    const hash = await emailHash(email);
    const owner = await env.DB.prepare(`SELECT id FROM users WHERE sup_email = ? AND id != ?`).bind(hash, user.id).first();
    if (owner) return json({ error: "Those payments are already linked to another FMCheck account." }, 409);
    const open = await env.DB.prepare(`SELECT COALESCE(SUM(days), 0) AS days, COALESCE(SUM(boosts), 0) AS boosts
      FROM payments WHERE email_hash = ? AND user_id IS NULL`).bind(hash).first();
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET sup_email = ? WHERE id = ?`).bind(hash, user.id),
      env.DB.prepare(`UPDATE payments SET user_id = ? WHERE email_hash = ? AND user_id IS NULL`).bind(user.id, hash),
      ...(open.days ? [extend(env, user.id, open.days)] : []),
      ...(open.boosts ? [addCredits(env, user.id, open.boosts)] : []),
    ]);
    const u = await env.DB.prepare(`SELECT id, ign, supporter_until, sup_code FROM users WHERE id = ?`).bind(user.id).first();
    return json({ user: await meInfo(env, u), found: open.days > 0 || open.boosts > 0 });
  }

  if (path === "/api/prices" && method === "GET") {
    const since = Date.now() - CROWD_DAYS * DAY;
    const [rows, reports] = await Promise.all([
      env.DB.prepare(`SELECT id, price, t FROM site_prices`).all(),
      env.DB.prepare(`SELECT id, price, t FROM price_reports WHERE t > ? ORDER BY id`).bind(since).all(),
    ]);
    // players' prices: the median per item, once enough different players typed one
    const prices = {}, from = {};
    let updated = 0;
    const byId = new Map();
    for (const r of reports.results) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
    for (const [id, list] of byId) {
      if (list.length < CROWD_MIN) continue;
      const ps = list.map((r) => r.price).sort((a, b) => a - b);
      const mid = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
      prices[id] = Math.round(mid);
      from[id] = list.length;
      updated = Math.max(updated, ...list.map((r) => r.t));
    }
    // admins' prices always win
    for (const r of rows.results) { prices[r.id] = r.price; delete from[r.id]; updated = Math.max(updated, r.t); }
    return json({ prices, updated, players: from });
  }
  if (path === "/api/prices/report" && method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const who = (await sha(`${ip}|${new Date().toISOString().slice(0, 10)}|fmcheck-prices`)).slice(0, 24);
    const today = await env.DB.prepare(`SELECT COUNT(*) AS n FROM price_reports WHERE who = ?`).bind(who).first();
    if ((today.n || 0) >= 300) return json({ ok: true }); // plenty from this player today
    const now = Date.now();
    const q = [];
    for (const [k, v] of Object.entries((body && body.prices) || {}).slice(0, 30)) {
      const id = +k, price = int(Math.round(+v), 1, 1e11);
      if (!price || (!equipById.has(id) && !scrollById.has(id))) continue;
      q.push(env.DB.prepare(`INSERT INTO price_reports (id, who, price, t) VALUES (?, ?, ?, ?)
        ON CONFLICT(id, who) DO UPDATE SET price = excluded.price, t = excluded.t`).bind(id, who, price, now));
    }
    q.push(env.DB.prepare(`DELETE FROM price_reports WHERE t < ?`).bind(now - CROWD_DAYS * DAY));
    await env.DB.batch(q);
    return json({ ok: true });
  }
  if (path === "/api/prices" && method === "PUT") {
    if (!isAdmin(env, user)) return json({ error: "Admins only." }, 403);
    const now = Date.now();
    const q = [];
    for (const [k, v] of Object.entries((body && body.prices) || {}).slice(0, 2000)) {
      const id = +k;
      if (!equipById.has(id) && !scrollById.has(id)) continue;
      const price = v == null || v === "" ? null : int(Math.round(+v), 1, 1e11);
      q.push(price ? env.DB.prepare(`INSERT INTO site_prices (id, price, t) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET price = excluded.price, t = excluded.t`).bind(id, price, now)
        : env.DB.prepare(`DELETE FROM site_prices WHERE id = ?`).bind(id));
    }
    if (q.length) await env.DB.batch(q);
    return json({ ok: true, saved: q.length });
  }

  if (path === "/api/admin/supporter" && method === "POST") {
    if (!isAdmin(env, user)) return json({ error: "Admins only." }, 403);
    const days = int(+body.days, -400, 400) || 0, boosts = int(+body.boosts, -100, 100) || 0;
    const code = String(body.code || "").trim().toUpperCase();
    const u = await env.DB.prepare(`SELECT id FROM users WHERE sup_code = ? OR id = ?`).bind(code, code.toLowerCase()).first();
    if (!u || (!days && !boosts)) return json({ error: "Unknown code, or nothing to add." }, 400);
    await env.DB.batch([...(days ? [extend(env, u.id, days)] : []), ...(boosts ? [addCredits(env, u.id, boosts)] : [])]);
    return json({ ok: true });
  }

  if (path === "/api/listings/cats" && method === "GET") {
    const demo = await demoOn(env);
    const { where, args } = listWhere(url.searchParams, Date.now(), true, demo);
    const rows = await env.DB.prepare(`SELECT l.cat AS cat, COUNT(*) AS n FROM listings l JOIN users u ON u.id = l.user_id
      WHERE ${where.join(" AND ")} GROUP BY l.cat`).bind(...args).all();
    const counts = {};
    for (const r of rows.results) counts[r.cat] = r.n;
    // and per item (same filters, any category), for the search suggestions
    const p2 = new URLSearchParams(url.searchParams);
    p2.delete("item"); p2.delete("q"); p2.delete("cat");
    const w2 = listWhere(p2, Date.now(), true, demo);
    const per = await env.DB.prepare(`SELECT l.item AS item, COUNT(*) AS n FROM listings l JOIN users u ON u.id = l.user_id
      WHERE ${w2.where.join(" AND ")} GROUP BY l.item`).bind(...w2.args).all();
    const items = {};
    for (const r of per.results) items[r.item] = r.n;
    return json({ counts, items });
  }

  if (path === "/api/listings" && method === "GET") {
    const p = url.searchParams;
    const now = Date.now();
    const { where, args, tab } = listWhere(p, now, false, await demoOn(env));
    const sort = tab === "rare" ? "rare" : tab === "featured" ? "featured" : p.get("sort");
    // Newest = when the item was first posted. "Still selling" and edits keep an item on the list but don't move it up;
    // only a boost does. Featured items come first in every list and search they match.
    // Examples come after real items (for examples, "created" is how long ago, so they sort by that among themselves).
    const by = sort === "featured" ? `l.demo ASC, l.featured_until DESC` : sort === "rare" ? `l.one_in DESC` : sort === "cheap" ? `l.price ASC`
      : sort === "pricey" ? `l.price DESC` : `(CASE WHEN l.demo > 0 THEN ${now} - l.created ELSE l.created END) DESC`;
    const featured = `(l.featured_until > ${now})`; // real boosts only: examples never get ahead of real items
    const order = sort === "featured" ? by : tab === "rare" ? `l.demo ASC, ${by}` : `${featured} DESC, l.demo ASC, ${by}`;
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
    if (!s.price) return json({ error: "Enter your asking price." }, 400);
    const counts = await env.DB.prepare(`SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN created > ? THEN 1 ELSE 0 END) AS today
        FROM listings WHERE user_id = ?`).bind(Date.now() - DAY, user.id).first();
    const max = isSupporter(user) ? MAX_ACTIVE_SUPPORTER : MAX_ACTIVE;
    if ((counts.active || 0) >= max) {
      return json({ error: `You can have ${max} items up at once${isSupporter(user) ? "" : ` (${MAX_ACTIVE_SUPPORTER} as a supporter)`}. Remove or mark one as sold first.`,
        upsell: !isSupporter(user) }, 429);
    }
    const now = Date.now();
    const fp = await fingerprint(l);
    const [posted, before] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND t > ?`).bind(user.id, now - DAY).first(),
      env.DB.prepare(`SELECT MIN(created) AS created FROM posts WHERE user_id = ? AND fp = ? AND t > ?`).bind(user.id, fp, now - REPOST_DAYS * DAY).first(),
    ]);
    const perDay = isSupporter(user) ? MAX_NEW_PER_DAY_SUPPORTER : MAX_NEW_PER_DAY;
    if ((posted.n || 0) >= perDay) {
      return json({ error: `That's ${perDay} new items today (removed ones count too). Try again tomorrow${isSupporter(user) ? "" : ` (supporters can post ${MAX_NEW_PER_DAY_SUPPORTER} a day)`}.`,
        upsell: !isSupporter(user) }, 429);
    }
    const created = before.created || now; // posted again: it keeps its place, it doesn't jump to the top
    const id = randomHex(6);
    await env.DB.prepare(`INSERT INTO listings (id, user_id, item, name, cat, clean, gained, stats, scrolls, upgrades, left_slots, slots,
        chance, one_in, est_lo, est_hi, price, channel, room, note, created, seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.id, l.item, l.name, l.cat, JSON.stringify(l.clean), JSON.stringify(l.gained), JSON.stringify(l.stats),
        JSON.stringify(l.scrolls), l.upgrades, l.left, l.slots, l.chance, l.oneIn, l.est?.lo ?? null, l.est?.hi ?? null,
        s.price ?? null, s.channel ?? null, s.room ?? null, s.note ?? null, created, now).run();
    await env.DB.prepare(`INSERT INTO posts (user_id, fp, created, t) VALUES (?, ?, ?, ?)`).bind(user.id, fp, created, now).run();
    // rare items go to Discord once, not again when re-posted
    if (!before.created) ctx.waitUntil(discordPost(env, { ...l, id, price: s.price }, user.ign, body.image, url.origin));
    return json({ id });
  }

  const m = /^\/api\/listings\/([a-f0-9]{12})(\/verify|\/flag|\/boost|\/unflag)?$/.exec(path);
  if (m) {
    const [, id, action] = m;
    const row = await env.DB.prepare(`SELECT ${COLS} FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`).bind(id).first();
    if (!row) return json({ error: "This item isn't listed anymore." }, 404);
    const mine = !!user && row.user_id === user.id;

    if (!action && method === "GET") return json({ listing: publicListing(row, user) });

    if (row.demo && method !== "GET" && !isAdmin(env, user)) return json({ error: "This is an example item." }, 400);

    if (action === "/flag" && method === "POST") {
      if (needUser()) return needUser();
      if (mine) return json({ error: "That's your own item." }, 400);
      // new or nameless accounts can't hide other players' items
      if (!user.ign || Date.now() - (user.created || 0) < FLAG_MIN_AGE) {
        return json({ error: "Thanks. Reports count from accounts that are a few days old; for now, tell us on Discord." }, 403);
      }
      await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO flags (listing, who) VALUES (?, ?)`).bind(id, user.id),
        env.DB.prepare(`UPDATE listings SET flags = (SELECT COUNT(*) FROM flags WHERE listing = ?) WHERE id = ?`).bind(id, id),
      ]);
      return json({ ok: true });
    }

    if (action === "/unflag" && method === "POST") {
      if (!isAdmin(env, user)) return json({ error: "Admins only." }, 403);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM flags WHERE listing = ?`).bind(id),
        env.DB.prepare(`UPDATE listings SET flags = 0 WHERE id = ?`).bind(id),
      ]);
      return json({ ok: true });
    }

    if (!mine && !(method === "DELETE" && isAdmin(env, user))) return json({ error: user ? "Not your item." : "Sign in first." }, user ? 403 : 401);

    if (action === "/boost" && method === "POST") {
      if (!isSupporter(user)) return json({ error: "Boosts are a supporter perk.", upsell: true }, 403);
      if (row.status !== "active") return json({ error: "Only items that are up can be featured." }, 400);
      if (row.featured_until > Date.now()) return json({ error: "It's already featured." }, 400);
      const b = await boostInfo(env, user);
      if (b.monthly + b.extra < 1) {
        return json({ error: `No boosts left. Get an extra one for $${+(env.BOOST_PRICE || 1)} (see Supporters), or wait: monthly boosts come back 30 days after each use.`, needBoost: true }, 429);
      }
      const now = Date.now();
      const mineUp = await env.DB.prepare(`SELECT COUNT(*) AS n FROM listings WHERE user_id = ? AND featured_until > ?`).bind(user.id, now).first();
      if (mineUp.n >= MAX_FEATURED_PER_USER) {
        return json({ error: `You already have ${MAX_FEATURED_PER_USER} items featured. Boost another when one ends, so everyone gets a turn.` }, 429);
      }
      const busy = await env.DB.prepare(`SELECT COUNT(*) AS n, MIN(featured_until) AS next FROM listings WHERE featured_until > ?`).bind(now).first();
      if (busy.n >= MAX_FEATURED) {
        const h = Math.max(1, Math.ceil((busy.next - now) / 3600e3));
        return json({ error: `All ${MAX_FEATURED} Featured spots are taken. One frees up in about ${h} hour${h === 1 ? "" : "s"}.` }, 429);
      }
      await env.DB.batch([
        env.DB.prepare(`UPDATE listings SET featured_until = ?, seen = ? WHERE id = ?`).bind(now + BOOST_HOURS * 3600e3, now, id),
        // the monthly ones first, then the bought ones
        env.DB.prepare(`INSERT INTO boosts (user_id, listing, t, paid) VALUES (?, ?, ?, ?)`).bind(user.id, id, now, b.monthly > 0 ? 0 : 1),
        ...(b.monthly > 0 ? [] : [env.DB.prepare(`UPDATE boost_credits SET n = n - 1 WHERE user_id = ? AND n > 0`).bind(user.id)]),
      ]);
      const l = publicListing(row, user);
      ctx.waitUntil(discordPost(env, l, row.ign, null, url.origin, true));
      const fresh = await env.DB.prepare(`SELECT ${COLS} FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`).bind(id).first();
      return json({ listing: publicListing(fresh, user), boostsLeft: await boostsLeft(env, user) });
    }

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
      if ("price" in s && !s.price) return json({ error: "Enter the asking price." }, 400);
      const sets = [], args = [];
      for (const [k, v] of Object.entries(s)) { sets.push(`${k} = ?`); args.push(v); }
      if (body.bump || Object.keys(s).length) { sets.push(`seen = ?`); args.push(Date.now()); }
      if (body.status === "sold") sets.push(`status = 'sold'`);
      else if (body.status === "active") sets.push(`status = 'active'`);
      if (!sets.length) return json({ error: "Nothing to change." }, 400);
      await env.DB.prepare(`UPDATE listings SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
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
