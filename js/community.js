// The community page: players' scrolled items, for sale or shown off, with the full picture of each one.
import { STATS, STAT_LABEL, mesos, readPrice } from "./calc.js?v=7840d99d";
import { drawCard, cardBlob } from "./card.js?v=7840d99d";
import { cardInfo, cardLabel, cardFmt, cardDate, rangeText, oneInText } from "./itemcard.js?v=7840d99d";
import { setupA11y } from "./a11y.js?v=7840d99d";
import { api, health, me, googleButton, signOut, validIgn, esc, ago, place, canSignIn } from "./account.js?v=7840d99d";
import { DISCORD_URL } from "./config.js?v=7840d99d";

const $ = (id) => document.getElementById(id);
const icon = (id) => `assets/items/${String(id).padStart(8, "0")}.png`;
const plus = (stats) => Object.entries(stats).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${STAT_LABEL[k] || k}`).join(", ");

let equipById = new Map(), scrollById = new Map();
let user = null, myListings = [];
let tab = "sale", offset = 0, shown = [];

setupA11y();
for (const a of document.querySelectorAll("[data-discord]")) a.href = DISCORD_URL;

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

// How the asking price compares with the estimate.
function fairness(l) {
  if (!l.price || !l.estimate) return "";
  const { lo, hi } = l.estimate;
  if (l.price < lo * 0.9) return `<span class="badge good" title="Below the estimate of ${rangeText(lo, hi)}">Below estimate</span>`;
  if (l.price > hi * 1.1) return `<span class="badge high" title="Above the estimate of ${rangeText(lo, hi)}">Above estimate</span>`;
  return `<span class="badge fair" title="Within the estimate of ${rangeText(lo, hi)}">Fair price</span>`;
}
const verifiedBadge = (l) => (l.verified ? `<span class="badge ok" title="The seller showed the item's window from the game and it matched">✓ Checked on screen</span>` : "");

function tile(l) {
  return `<li><button type="button" class="tile" data-id="${l.id}">
    <span class="tile-icon"><img src="${icon(l.item)}" alt="" width="40" height="40" /></span>
    <span class="tile-main">
      <span class="tile-name">${esc(l.name)}${l.upgrades ? ` <b>(+${l.upgrades})</b>` : ""}</span>
      <span class="tile-stats">${esc(plus(l.gained)) || "clean"} · ${l.left} slot${l.left === 1 ? "" : "s"} left</span>
      <span class="tile-seller">${l.ign ? `<b>${esc(l.ign)}</b>` : ""}${place(l) ? ` · ${place(l)}` : ""} · ${ago(l.seen)}</span>
      <span class="tile-badges">${verifiedBadge(l)}${fairness(l)}${l.status === "sold" ? `<span class="badge">Sold</span>` : ""}</span>
    </span>
    <span class="tile-side">
      ${l.price ? `<b class="tile-price">${mesos(l.price)}</b>` : `<span class="tile-show">Showcase</span>`}
      <small>${oneInText(l.oneIn)}</small>
    </span>
  </button></li>`;
}

// ---------- the list ----------

function query() {
  const q = new URLSearchParams({ tab, offset });
  const v = (id) => $(id).value.trim();
  if (v("fQ")) q.set("q", v("fQ"));
  if (v("fCat")) q.set("cat", v("fCat"));
  if (v("fStat") && v("fMin")) { q.set("stat", v("fStat")); q.set("min", v("fMin")); }
  if (v("fLeft")) q.set("left", v("fLeft"));
  if (tab !== "rare") q.set("sort", v("fSort"));
  if ($("fVerified").checked) q.set("verified", "1");
  return q;
}

async function load(more = false) {
  const box = $("listings");
  if (tab === "mine") return renderMine();
  $("filters").hidden = false;
  if (!more) { offset = 0; shown = []; box.innerHTML = `<p class="hint">Loading…</p>`; }
  try {
    const j = await api(`/api/listings?${query()}`);
    shown = shown.concat(j.listings);
    offset = shown.length;
    $("more").hidden = !j.more;
    box.innerHTML = shown.length ? `<ul class="tiles">${shown.map(tile).join("")}</ul>` : `<p class="hint">${
      tab === "sale" ? "Nothing for sale matches yet." : tab === "show" ? "No items shown off yet." : "No items this week yet."}
      Be the first: work out your item in the <a href="./">calculator</a> and press Publish.</p>`;
  } catch (e) {
    box.innerHTML = `<p class="hint">${esc(e.status === 503 ? "The community opens soon." : e.message)}</p>`;
  }
}

function setTab(t) {
  tab = t;
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === t));
  $("fSort").disabled = t === "rare";
  load();
}
document.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
let filterTimer;
$("filters").addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => load(), 300); });
$("filters").addEventListener("submit", (e) => { e.preventDefault(); load(); });
$("more").addEventListener("click", () => load(true));
$("listings").addEventListener("click", (e) => {
  const b = e.target.closest(".tile");
  if (b) openDetail(b.dataset.id);
});

// ---------- one item ----------

function cardFor(l) {
  const e = equipById.get(l.item);
  if (!e) return null;
  return cardInfo({
    equip: e, fin: l.stats, clean: l.clean, left: l.left, upgrades: l.upgrades,
    price: l.estimate, priceHint: "No estimate (prices weren't entered)",
    chance: l.chance, oneIn: l.oneIn,
    scrolls: l.scrolls.map((s) => ({ n: s.n, name: scrollById.get(s.id)?.name || "Scroll" })),
    date: cardDate(l.created), footer: "Seller's prices when published",
  });
}

async function openDetail(id) {
  const dlg = $("detail");
  $("detailBody").innerHTML = `<p class="hint">Loading…</p>`;
  if (!dlg.open) dlg.showModal();
  history.replaceState(null, "", `#l=${id}`);
  let l;
  try { l = (await api(`/api/listings/${id}`)).listing; }
  catch (e) { $("detailBody").innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  $("detailTitle").textContent = `${l.name}${l.upgrades ? ` (+${l.upgrades})` : ""}`;
  const calc = new URLSearchParams({ i: l.item });
  const r = Object.entries(l.clean).map(([k, v]) => `${k}.${v}`).join(",");
  if (r) calc.set("r", r);
  calc.set("l", l.left);
  if (l.scrolls.length) calc.set("s", l.scrolls.map((s) => `${s.id}.${s.n}`).join(","));
  $("detailBody").innerHTML = `
    <div class="detail-grid">
      <canvas id="detailCard" class="item-card" role="img"></canvas>
      <div class="detail-info">
        ${l.status === "sold" ? `<p class="badge">Sold</p>` : ""}
        <p class="detail-price">${l.price ? `<b>${mesos(l.price)}</b> asking` : "Showcase: not for sale"} ${fairness(l)}</p>
        ${l.estimate ? `<p class="hint">FMCheck estimate: ${rangeText(l.estimate.lo, l.estimate.hi)} (from the seller's prices on ${cardDate(l.created)})</p>` : ""}
        <p>${verifiedBadge(l) || `<span class="badge">Not checked on screen</span>`}</p>
        <dl class="detail-facts">
          <dt>Seller</dt><dd>${l.ign ? `<b>${esc(l.ign)}</b> <button type="button" class="ghost-btn mini" id="copyIgn">Copy name</button>` : "–"}</dd>
          <dt>Where</dt><dd>${place(l) || "Ask the seller"}</dd>
          <dt>Last seen</dt><dd>${ago(l.seen)}</dd>
          ${l.note ? `<dt>Note</dt><dd>${esc(l.note)}</dd>` : ""}
          <dt>Chance of one like it</dt><dd>${oneInText(l.oneIn)}</dd>
        </dl>
        <div class="detail-actions">
          <a class="ghost-btn" href="./#${calc}">Open in the calculator</a>
          <button type="button" class="ghost-btn" id="copyLink">Copy link</button>
          <button type="button" class="ghost-btn" id="saveCard">⬇ Image</button>
          ${l.mine ? "" : `<button type="button" class="ghost-btn" id="flag">🚩 Report</button>`}
        </div>
        <p id="detailMsg" class="sale-msg" role="status"></p>
      </div>
    </div>`;
  const d = cardFor(l);
  if (d) { $("detailCard").setAttribute("aria-label", cardLabel(d)); drawCard($("detailCard"), d, cardFmt); }
  const copy = (text, done) => navigator.clipboard.writeText(text).then(() => toast(done)).catch(() => {});
  $("copyIgn")?.addEventListener("click", () => copy(l.ign, `"${l.ign}" copied. Whisper them in game.`));
  $("copyLink").addEventListener("click", () => copy(`${location.origin}${location.pathname}#l=${l.id}`, "Link copied."));
  $("saveCard").addEventListener("click", async () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await cardBlob($("detailCard")));
    a.download = `fmcheck-${l.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("flag")?.addEventListener("click", async () => {
    if (!user) { $("detailMsg").textContent = "Sign in (top of the page) to report an item."; return; }
    if (!confirm("Report this item as fake or wrong?")) return;
    try { await api(`/api/listings/${l.id}/flag`, { method: "POST", body: {} }); $("detailMsg").textContent = "Thanks, reported."; }
    catch (e) { $("detailMsg").textContent = e.message; }
  });
}
$("detailClose").addEventListener("click", () => $("detail").close());
$("detail").addEventListener("close", () => history.replaceState(null, "", location.pathname));
$("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });

// ---------- account and my items ----------

function renderAccount() {
  const box = $("accountBody");
  document.querySelector('[data-tab="mine"]').hidden = !user;
  if (!user) {
    box.innerHTML = `<div class="account-row"><p><b>Sell or show off your scrolled items.</b>
      Sign in to put your items up. No email or name is stored, only the in-game name you choose.</p><div id="gbtn"></div></div>`;
    googleButton($("gbtn"), (u) => { user = u; refreshMe(); });
    return;
  }
  box.innerHTML = `<form id="ignForm" class="account-row">
      <label>In-game name <input id="ign" value="${esc(user.ign || "")}" maxlength="13" placeholder="e.g. GuaiLan" /></label>
      <button type="submit">Save</button>
      <span class="spacer"></span>
      <button type="button" class="ghost-btn" id="signOut">Sign out</button>
      <button type="button" class="ghost-btn" id="deleteMe">Delete account</button>
    </form><p id="accountMsg" class="sale-msg" role="status">${user.ign ? "" : "Add your in-game name so buyers can find you."}</p>`;
  $("ignForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ign = $("ign").value.trim();
    if (!validIgn(ign)) { $("accountMsg").textContent = "2–13 letters or numbers."; return; }
    try { user = (await api("/api/me", { method: "PUT", body: { ign } })).user; $("accountMsg").textContent = "Saved."; if (tab === "mine") renderMine(); }
    catch (err) { $("accountMsg").textContent = err.message; }
  });
  $("signOut").addEventListener("click", async () => { await signOut(); user = null; myListings = []; renderAccount(); if (tab === "mine") setTab("sale"); });
  $("deleteMe").addEventListener("click", async () => {
    if (!confirm("Delete your account and all your items? This can't be undone.")) return;
    try { await api("/api/me", { method: "DELETE" }); user = null; myListings = []; renderAccount(); setTab("sale"); toast("Your account was deleted."); }
    catch (err) { $("accountMsg").textContent = err.message; }
  });
}

async function refreshMe() {
  const m = await me(true);
  user = m.user;
  myListings = m.listings || [];
  renderAccount();
  if (tab === "mine") renderMine();
}

function renderMine() {
  $("filters").hidden = true;
  $("more").hidden = true;
  const box = $("listings");
  if (!user) { box.innerHTML = `<p class="hint">Sign in to see your items.</p>`; return; }
  if (!myListings.length) { box.innerHTML = `<p class="hint">You haven't put up any items yet. Work one out in the <a href="./">calculator</a> and press Publish.</p>`; return; }
  box.innerHTML = `<ul class="mine">${myListings.map((l) => `<li data-id="${l.id}">
      <ul class="tiles">${tile(l)}</ul>
      <div class="mine-actions">
        ${l.status === "active" ? `
        ${l.price ? `<button type="button" data-act="bump">🟢 Still selling</button>` : ""}
        <button type="button" class="ghost-btn" data-act="edit">✏️ Price & place</button>
        ${l.verified ? "" : `<button type="button" class="ghost-btn" data-act="verify">✓ Check on screen</button>`}
        ${l.price ? `<button type="button" class="ghost-btn" data-act="sold">💰 Sold</button>` : ""}` : `<span class="hint">Sold</span>`}
        <button type="button" class="ghost-btn" data-act="remove">🗑 Remove</button>
      </div>
      <form class="mine-edit" hidden>
        <label>Price <input name="price" inputmode="decimal" value="${l.price ? mesos(l.price) : ""}" placeholder="empty = showcase" /></label>
        <label>Channel <input name="channel" inputmode="numeric" value="${l.channel || ""}" maxlength="2" /></label>
        <label>FM room <input name="room" inputmode="numeric" value="${l.room || ""}" maxlength="2" /></label>
        <label>Note <input name="note" value="${esc(l.note || "")}" maxlength="140" /></label>
        <button type="submit">Save</button>
      </form>
    </li>`).join("")}</ul>`;
}

async function patch(id, body, done) {
  try {
    const j = await api(`/api/listings/${id}`, { method: "PATCH", body });
    myListings = myListings.map((x) => (x.id === id ? j.listing : x));
    renderMine();
    if (done) toast(done);
  } catch (e) { toast(e.message); }
}

$("listings").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  e.stopPropagation();
  const li = b.closest("[data-id]");
  const id = li.dataset.id;
  const l = myListings.find((x) => x.id === id);
  const act = b.dataset.act;
  if (act === "bump") patch(id, { bump: true }, "Up for 3 more days.");
  if (act === "edit") { const f = li.querySelector(".mine-edit"); f.hidden = !f.hidden; }
  if (act === "sold") {
    const text = prompt("What did it sell for? (e.g. 350m) It's added to the reported sales, anonymously. Leave empty to skip.", l.price ? mesos(l.price) : "");
    if (text === null) return;
    const sold = text.trim() ? readPrice(text, "") : null;
    patch(id, { status: "sold", soldPrice: sold }, "Marked as sold. Congrats!");
  }
  if (act === "remove") {
    if (!confirm("Remove this item from FMCheck?")) return;
    try { await api(`/api/listings/${id}`, { method: "DELETE" }); myListings = myListings.filter((x) => x.id !== id); renderMine(); toast("Removed."); }
    catch (err) { toast(err.message); }
  }
  if (act === "verify") {
    const { startVerify } = await import(new URL(`./verify.js${new URL(import.meta.url).search}`, import.meta.url));
    startVerify(l, equipById.get(l.item), async () => { await refreshMe(); toast("✓ Checked on screen. Your item now shows the badge."); });
  }
});
$("listings").addEventListener("submit", (e) => {
  const f = e.target.closest(".mine-edit");
  if (!f) return;
  e.preventDefault();
  const id = f.closest("[data-id]").dataset.id;
  const price = f.price.value.trim() ? readPrice(f.price.value, "") : null;
  if (f.price.value.trim() && !(price > 0)) { toast("The price doesn't look right, e.g. 350m."); return; }
  patch(id, { price, channel: f.channel.value.trim(), room: f.room.value.trim(), note: f.note.value.trim() }, "Saved.");
});

// ---------- start ----------

(async function start() {
  const [eq, sc, h] = await Promise.all([
    fetch("data/equips.json").then((r) => r.json()),
    fetch("data/scrolls.json").then((r) => r.json()),
    health(),
  ]);
  equipById = new Map(eq.map((e) => [e[0], e]));
  scrollById = new Map(sc.map((s) => [s.id, s]));
  $("equipNames").innerHTML = eq.map((e) => `<option value="${esc(e[1])}"></option>`).join("");
  const cats = [...new Set(eq.map((e) => (Math.floor(e[0] / 10000) >= 130 ? "Weapon" : e[3])))].sort();
  $("fCat").innerHTML += cats.map((c) => `<option>${esc(c)}</option>`).join("");
  $("fStat").innerHTML += STATS.filter(([k]) => !["CRT", "CRD"].includes(k)).map(([k, label]) => `<option value="${k}">${label}</option>`).join("");
  if (!h.community) {
    $("accountBody").innerHTML = `<p class="hint">The community opens soon. Meanwhile, price your items in the <a href="./">calculator</a>.</p>`;
    $("listings").innerHTML = "";
    $("filters").hidden = true;
    return;
  }
  if (canSignIn()) await refreshMe();
  else renderAccount();
  load();
  const id = /^#l=([a-f0-9]{12})$/.exec(location.hash)?.[1];
  if (id) openDetail(id);
})();
