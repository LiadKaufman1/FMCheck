// The community page: players' scrolled items, for sale or shown off, with the full picture of each one.
import { STATS, STAT_LABEL, mesos, readPrice } from "./calc.js?v=e0f53882";
import { drawCard, cardBlob } from "./card.js?v=e0f53882";
import { cardInfo, cardLabel, cardFmt, cardDate, rangeText, oneInText } from "./itemcard.js?v=e0f53882";
import { setupA11y } from "./a11y.js?v=e0f53882";
import { api, health, me, googleButton, signOut, validIgn, esc, ago, place, canSignIn } from "./account.js?v=e0f53882";
import { itemSearch } from "./itemsearch.js?v=e0f53882";
import { DISCORD_URL } from "./config.js?v=e0f53882";

const $ = (id) => document.getElementById(id);
const icon = (id) => `assets/items/${String(id).padStart(8, "0")}.png`;
const plus = (stats) => Object.entries(stats).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${STAT_LABEL[k] || k}`).join(", ");

let equipById = new Map(), scrollById = new Map();
let user = null, myListings = [], healthInfo = {};
let tab = "sale", offset = 0, shown = [];

// ---------- market search: the calculator's item search, filtering the list (js/itemsearch.js) ----------

let picked = null;           // an item chosen from the suggestions: show only that item
let catCounts = {}, catTotal = 0, itemCounts = {};
const fQ = $("fQ");
const market = itemSearch({
  cats: $("mCats"), input: fQ, results: $("mResults"), job: $("fJob"), idPrefix: "mopt", noun: "up",
  onPick: (e) => { picked = e; fQ.value = e[1]; load(); },
  onChange: () => { picked = null; load(); },
  isPicked: () => !!picked && fQ.value === picked[1],
  count: (key) => (key ? catCounts[key] || 0 : catTotal),
  badge: (e) => itemCounts[e[0]] || 0,
  badgeText: (n) => `${n} ${tab === "show" ? "shown" : tab === "sale" ? "for sale" : "up"}`,
});
let typeTimer;
fQ.addEventListener("input", () => {
  if (picked && fQ.value !== picked[1]) picked = null;
  clearTimeout(typeTimer);
  typeTimer = setTimeout(() => load(), 350);
});

setupA11y();
for (const a of document.querySelectorAll("[data-discord]")) a.href = DISCORD_URL;

function toast(text, upsell = false) {
  const t = $("toast");
  t.textContent = text;
  if (upsell) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sup-link";
    b.textContent = "⭐ See supporter perks";
    b.addEventListener("click", () => { t.hidden = true; toSupporters(); });
    t.append(" ", b);
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, upsell ? 8000 : 3500);
}

// How the asking price compares with the estimate.
// The estimate comes from prices the seller typed, so it can only warn: a seller could inflate it to make a price look good.
function fairness(l) {
  if (!l.price || !l.estimate) return "";
  const { lo, hi } = l.estimate;
  if (l.price > hi * 1.1) return `<span class="badge high" title="Above the seller's own estimate of ${rangeText(lo, hi)}">Above estimate</span>`;
  return "";
}
const verifiedBadge = (l) => (l.verified ? `<span class="badge ok" title="The seller showed the item's window from the game and it matched">✓ Checked on screen</span>` : "");

const supporterBadge = (l) => (l.supporter ? `<span class="badge sup" title="Supports FMCheck">⭐ Supporter</span>` : "");
function tile(l) {
  return `<li><button type="button" class="tile${l.featured ? " is-featured" : ""}" data-id="${l.id}">
    <span class="tile-icon"><img src="${icon(l.item)}" alt="" width="40" height="40" /></span>
    <span class="tile-main">
      <span class="tile-name">${esc(l.name)}${l.upgrades ? ` <b>(+${l.upgrades})</b>` : ""}</span>
      <span class="tile-stats">${esc(plus(l.gained)) || "clean"} · ${l.left} slot${l.left === 1 ? "" : "s"} left</span>
      <span class="tile-seller">${l.ign ? `<b>${esc(l.ign)}</b>` : ""}${place(l) ? ` · ${place(l)}` : ""} · ${ago(l.seen)}</span>
      <span class="tile-badges">${l.demo ? `<span class="badge demo" title="Not a real listing: an example while the community fills up">Example</span>` : ""}${l.featured ? `<span class="badge feat">⭐ Featured</span>` : ""}${verifiedBadge(l)}${fairness(l)}${supporterBadge(l)}${l.status === "sold" ? `<span class="badge">Sold</span>` : ""}</span>
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
  if (picked) q.set("item", picked[0]);
  else if (fQ.value.trim()) q.set("q", fQ.value.trim());
  if (market.filter.cat) q.set("cat", market.filter.cat);
  if (market.filter.job) q.set("job", market.filter.job);
  if (v("fStat") && v("fMin")) { q.set("stat", v("fStat")); q.set("min", v("fMin")); }
  if (v("fLeft")) q.set("left", v("fLeft"));
  if (tab !== "rare") q.set("sort", v("fSort"));
  if ($("fVerified").checked) q.set("verified", "1");
  return q;
}

async function load(more = false) {
  const box = $("listings");
  if (tab === "mine") return renderMine();
  $("market").hidden = false;
  if (!more) { offset = 0; shown = []; box.innerHTML = `<p class="hint">Loading…</p>`; loadCounts(); }
  try {
    const j = await api(`/api/listings?${query()}`);
    shown = shown.concat(j.listings);
    offset = shown.length;
    $("more").hidden = !j.more;
    const demoNote = shown.some((l) => l.demo)
      ? `<p class="demo-note">Items tagged <span class="badge demo">Example</span> aren't real listings: they show how FMCheck works while the community fills up.</p>` : "";
    box.innerHTML = shown.length ? `${demoNote}<ul class="tiles">${shown.map(tile).join("")}</ul>` : `<p class="hint">${
      tab === "sale" ? "Nothing for sale matches yet." : tab === "show" ? "No items shown off yet." : "No items this week yet."}
      Be the first: work out your item in the <a href="./">calculator</a> and press Publish.</p>`;
  } catch (e) {
    box.innerHTML = `<p class="hint">${esc(e.status === 503 ? "The community opens soon." : e.message)}</p>`;
  }
}

async function loadFeatured() {
  try {
    const j = await api("/api/listings?tab=featured");
    $("featured").hidden = !j.listings.length;
    $("featuredList").innerHTML = j.listings.map(tile).join("");
  } catch { $("featured").hidden = true; }
}
$("featuredList").addEventListener("click", (e) => { const b = e.target.closest(".tile"); if (b) openDetail(b.dataset.id); });

// The numbers on the category chips: how many items are up in this tab, with the other filters.
async function loadCounts() {
  const q = query();
  q.delete("offset"); q.delete("sort"); q.delete("cat");
  try {
    const j = await api(`/api/listings/cats?${q}`);
    catCounts = j.counts || {};
    itemCounts = j.items || {};
    catTotal = Object.values(catCounts).reduce((a, b) => a + b, 0);
  } catch { catCounts = {}; catTotal = 0; itemCounts = {}; }
  market.renderCats();
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
        ${l.demo ? `<p class="demo-banner"><b>Example item.</b> This isn't a real listing and the seller isn't a real player:
          it shows how items look on FMCheck. Put up your own from the <a href="./">calculator</a>.</p>` : ""}
        ${l.status === "sold" ? `<p class="badge">Sold</p>` : ""}
        <p class="detail-price">${l.price ? `<b>${mesos(l.price)}</b> asking` : "Showcase: not for sale"} ${fairness(l)}</p>
        ${l.estimate ? `<p class="hint">Seller's estimate: ${rangeText(l.estimate.lo, l.estimate.hi)}, from scroll prices the seller entered on ${cardDate(l.created)}.
          Check today's prices yourself in the <a href="./#i=${l.item}">calculator</a>.</p>` : ""}
        <p>${verifiedBadge(l) || `<span class="badge">Not checked on screen</span>`}</p>
        <dl class="detail-facts">
          <dt>Seller</dt><dd>${l.ign ? `<b>${esc(l.ign)}</b> ${supporterBadge(l)} ${l.demo ? `<span class="badge demo">Example</span>`
            : `<button type="button" class="ghost-btn mini" id="copyIgn">Copy name</button>`}` : "–"}</dd>
          <dt>Where</dt><dd>${place(l) || "Ask the seller"}</dd>
          <dt>Last seen</dt><dd>${ago(l.seen)}</dd>
          ${l.note ? `<dt>Note</dt><dd>${esc(l.note)}</dd>` : ""}
          <dt>Chance of one like it</dt><dd>${oneInText(l.oneIn)}</dd>
        </dl>
        <div class="detail-actions">
          <a class="ghost-btn" href="./#${calc}">Open in the calculator</a>
          <button type="button" class="ghost-btn" id="copyLink">Copy link</button>
          <button type="button" class="ghost-btn" id="saveCard">⬇ Image</button>
          ${l.mine || l.demo ? "" : `<button type="button" class="ghost-btn" id="flag">🚩 Report</button>`}
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
    </form><p id="accountMsg" class="sale-msg" role="status">${user.ign ? "" : "Add your in-game name so buyers can find you."}</p>
    ${user.supporter ? `<p class="sup-status">⭐ Supporter until ${cardDate(user.supporterUntil)} · ${user.monthlyLeft} of ${user.perMonth} monthly boosts left${user.extraBoosts ? ` + ${user.extraBoosts} extra` : ""}. Thank you!</p>` : ""}`;
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
  renderSupporter();
  if (tab === "mine") renderMine();
}

function renderMine() {
  $("market").hidden = true;
  $("more").hidden = true;
  const box = $("listings");
  if (!user) { box.innerHTML = `<p class="hint">Sign in to see your items.</p>`; return; }
  if (!myListings.length) { box.innerHTML = `<p class="hint">You haven't put up any items yet. Work one out in the <a href="./">calculator</a> and press Publish.</p>`; return; }
  box.innerHTML = `<ul class="mine">${myListings.map((l) => `<li data-id="${l.id}">
      <ul class="tiles">${tile(l)}</ul>
      <div class="mine-actions">
        ${l.status === "active" ? `
        ${l.price ? `<button type="button" data-act="bump">🟢 Still selling</button>` : ""}
        ${l.featured ? `<span class="badge feat">⭐ Featured until ${new Date(l.featured).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>`
          : `<button type="button" class="ghost-btn boost" data-act="boost">⭐ Feature for 24h${user.supporter ? (user.boostsLeft ? ` (${user.boostsLeft} left)` : ` · $${healthInfo.boostPrice || 1}`) : ""}</button>`}
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
  if (act === "bump") patch(id, { bump: true }, `Kept up for ${user.supporter ? 7 : 3} more days.`);
  if (act === "boost") {
    if (!user.supporter) { toast("Featuring an item is a supporter perk.", true); return; }
    if (!user.boostsLeft) {
      $("buyBoost")?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast(`No boosts left. Get an extra one for $${healthInfo.boostPrice || 1} below.`);
      return;
    }
    if (!confirm(`Feature this item at the top for 24 hours? It uses 1 of your ${user.boostsLeft} boosts.`)) return;
    try {
      const j = await api(`/api/listings/${id}/boost`, { method: "POST", body: {} });
      myListings = myListings.map((x) => (x.id === id ? j.listing : x));
      user = (await me(true)).user || user;
      renderMine(); renderAccount(); renderSupporter(); loadFeatured();
      toast("⭐ Featured for 24 hours.");
    } catch (err) { toast(err.message, !!err.upsell); }
  }
  if (act === "edit") { const f = li.querySelector(".mine-edit"); f.hidden = !f.hidden; }
  if (act === "sold") {
    if (!confirm("Mark this item as sold? It comes off the lists.")) return;
    patch(id, { status: "sold" }, "Marked as sold. Congrats!");
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

// ---------- supporters (Ko-fi) ----------

function renderSupporter() {
  const card = $("supporterCard");
  card.hidden = false;
  $("supBtn").textContent = user && user.supporter ? "⭐ Supporter" : "⭐ Become a supporter";
  const price = healthInfo.supporterPrice || 3, boostPrice = healthInfo.boostPrice || 1;
  const perks = `<table class="sup-table">
      <caption class="sr-only">Free and supporter accounts compared</caption>
      <thead><tr><th scope="col"><span class="sr-only">Perk</span></th><th scope="col">Free</th><th scope="col">⭐ Supporter</th></tr></thead>
      <tbody>
        <tr><th scope="row">Items up at once</th><td>3</td><td><b>10</b></td></tr>
        <tr><th scope="row">Days on the for-sale list</th><td>3</td><td><b>7</b></td></tr>
        <tr><th scope="row">New items a day</th><td>4</td><td><b>20</b></td></tr>
        <tr><th scope="row">⭐ Featured boosts</th><td>–</td><td><b>2 a month</b>, more for $${boostPrice} each</td></tr>
        <tr><th scope="row">Badge next to your name</th><td>–</td><td><span class="badge sup">⭐ Supporter</span></td></tr>
        <tr class="price-row"><th scope="row">Price</th><td>Free</td><td><b>$${price} / month</b></td></tr>
      </tbody>
    </table>
    <p class="hint"><b>What a boost does:</b> for 24 hours the item sits in the Featured row at the top of this page, comes first in every
      list and search it matches, and is posted on our Discord. And you keep FMCheck free and running. Thank you!</p>`;
  if (user && user.supporter) {
    $("supTitle").textContent = "⭐ You're an FMCheck supporter";
    $("supporterBody").innerHTML = `<p>Supporter until <b>${cardDate(user.supporterUntil)}</b>. Your monthly payment on Ko-fi keeps it going;
      you can stop it there any time.</p>
      <p class="sup-status">Boosts: ${user.monthlyLeft} of ${user.perMonth} monthly left${user.extraBoosts ? ` + ${user.extraBoosts} extra` : ""}.</p>
      <div class="buy-boost" id="buyBoost">
        <h3>⭐ Need more boosts?</h3>
        <ol class="sup-steps">
          <li>Copy your code: <code>${esc(user.code)}</code> <button type="button" class="ghost-btn mini" data-copy-code>Copy</button></li>
          <li><a class="btn-link" href="${esc(healthInfo.kofiUrl)}" target="_blank" rel="noopener">Buy on Ko-fi ↗</a>
            as a one-time support: <b>$${boostPrice} per boost</b> (e.g. $3 = 3 boosts). Paste the code in the message box.</li>
        </ol>
        <p class="hint">Extra boosts are added within a minute and don't run out. Your monthly boosts are used first.</p>
      </div>${perks}`;
    for (const b of document.querySelectorAll("[data-copy-code]")) b.addEventListener("click", () => navigator.clipboard.writeText(user.code).then(() => toast("Code copied. Paste it in the Ko-fi message.")).catch(() => {}));
    return;
  }
  $("supTitle").textContent = "⭐ Become an FMCheck supporter";
  if (!healthInfo.supporters) {
    $("supporterBody").innerHTML = `<p>Paid monthly on Ko-fi (card or PayPal). Cancel any time.</p>${perks}
      <p class="sup-soon">⏳ Memberships open very soon. Keep an eye on our
        <a href="${DISCORD_URL}" target="_blank" rel="noopener">Discord</a> for the launch.</p>`;
    return;
  }
  $("supporterBody").innerHTML = `<p>Paid monthly on Ko-fi (card or PayPal). Cancel any time.</p>${perks}
    ${user ? `<ol class="sup-steps">
      <li>Copy your code: <code id="supCode">${esc(user.code)}</code> <button type="button" class="ghost-btn mini" id="copyCode">Copy</button></li>
      <li><a class="btn-link" href="${esc(healthInfo.kofiUrl)}" target="_blank" rel="noopener">Join on Ko-fi ↗</a>
        (Membership, $${price} a month) and paste the code in the message box. Your perks turn on within a minute.</li>
    </ol>
    <details class="sup-claim"><summary>Already paid but no perks?</summary>
      <form id="claimForm" class="account-row"><label>Email you used on Ko-fi <input id="claimEmail" type="email" autocomplete="email" /></label>
      <button type="submit">Link my payment</button></form>
      <p class="hint">The email is only used to find your payment: we keep a one-way code of it, never the email itself.</p>
      <p id="claimMsg" class="sale-msg" role="status"></p>
    </details>` : `<p class="hint">Sign in first (top of the page), so your perks go to your account.</p>`}
    <p class="hint">Payments go through Ko-fi; FMCheck never sees your card. Supporting is voluntary and doesn't buy anything in the game.
      Perks may change. <a href="terms.html#supporters">Supporter terms</a></p>`;
  $("copyCode")?.addEventListener("click", () => navigator.clipboard.writeText(user.code).then(() => toast("Code copied. Paste it in the Ko-fi message.")).catch(() => {}));
  $("claimForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const j = await api("/api/me/claim", { method: "POST", body: { email: $("claimEmail").value } });
      if (j.found) { user = j.user; renderAccount(); renderSupporter(); toast("⭐ Linked! You're a supporter."); }
      else $("claimMsg").textContent = "No payment found for that email yet. It can take a minute after paying. Renewals will link to it by themselves.";
    } catch (err) { $("claimMsg").textContent = err.message; }
  });
}

// Subscribe buttons: the header and the Featured row both lead to the supporter box.
const toSupporters = () => {
  $("supporterCard").hidden = false;
  $("supporterCard").scrollIntoView({ behavior: "smooth", block: "start" });
  $("supTitle").setAttribute("tabindex", "-1");
  $("supTitle").focus({ preventScroll: true });
};
$("supBtn").addEventListener("click", toSupporters);
$("featureYours").addEventListener("click", toSupporters);

// ---------- start ----------

(async function start() {
  const [eq, sc, h] = await Promise.all([
    fetch("data/equips.json").then((r) => r.json()),
    fetch("data/scrolls.json").then((r) => r.json()),
    health(),
  ]);
  equipById = new Map(eq.map((e) => [e[0], e]));
  scrollById = new Map(sc.map((s) => [s.id, s]));
  market.setEquips(eq);
  $("fStat").innerHTML += STATS.filter(([k]) => !["CRT", "CRD"].includes(k)).map(([k, label]) => `<option value="${k}">${label}</option>`).join("");
  healthInfo = h;
  if (!h.community) {
    $("accountBody").innerHTML = `<p class="hint">The community opens soon. Meanwhile, price your items in the <a href="./">calculator</a>.</p>`;
    $("listings").innerHTML = "";
    $("market").hidden = true;
    return;
  }
  if (canSignIn()) await refreshMe();
  else { renderAccount(); renderSupporter(); }
  load();
  loadFeatured();
  if (location.hash === "#supporters") setTimeout(toSupporters, 300);
  const id = /^#l=([a-f0-9]{12})$/.exec(location.hash)?.[1];
  if (id) openDetail(id);
})();
