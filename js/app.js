import { iconUrl, priceLink, DONATE_URL, DISCORD_URL } from "./config.js?v=28ef07c7";
import { STATS, STAT_LABEL, statRange, rollAtLeast, groupOdds, allocateFailures, finalStats, openSlotsBonus, cheapestRoute, failedItemValue, mesos, UNITS, readPrice } from "./calc.js?v=28ef07c7";
import { getPrice, setPrice } from "./prices.js?v=28ef07c7";
import { drawCard, cardBlob } from "./card.js?v=28ef07c7";
import { cardInfo, cardLabel, cardFmt } from "./itemcard.js?v=28ef07c7";
import { itemSearch } from "./itemsearch.js?v=28ef07c7";
import { setupA11y } from "./a11y.js?v=28ef07c7";
import { API, api, health, me, googleButton, validIgn } from "./account.js?v=28ef07c7";

const $ = (id) => document.getElementById(id);
const icon = iconUrl;
const rangeText = (lo, hi) => (lo === hi ? mesos(lo) : `${mesos(lo)} – ${mesos(hi)}`);

// A price field: one average price and a unit dropdown.
// `p` is a saved { lo, hi } to fill in (an older saved range shows as its middle), or null; `unit` is the default unit.
function rangeFields(p, unit) {
  let value = "";
  if (p) {
    const avg = (p.lo + p.hi) / 2;
    const u = UNITS.slice().reverse().find(([, , m]) => m > 1 && avg >= m) || UNITS[0];
    unit = u[0];
    value = String(+(avg / u[2]).toPrecision(4));
  }
  return `<input inputmode="decimal" placeholder="average price" aria-label="Average price" value="${value}" data-f="price" />
    ${unitSelect(unit, 'data-f="unit"')}`;
}
// The price typed, as { lo, hi } with both the same (the estimate's math works with ranges), or null.
const readFields = (box) => {
  const v = readPrice(box.querySelector('[data-f="price"]').value, box.querySelector('[data-f="unit"]').value);
  return Number.isFinite(v) && v > 0 ? { lo: v, hi: v } : null;
};
// <select> of price units; `unit` is preselected.
const unitSelect = (unit, attrs = "") => `<select ${attrs} aria-label="Unit">${UNITS.map(([v, label]) =>
  `<option value="${v}"${v === unit ? " selected" : ""}>${label}</option>`).join("")}</select>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plusList = (stats) => Object.entries(stats).map(([k, v]) => `+${v} ${STAT_LABEL[k] || k}`).join(", ");

let equips = [];     // [id, name, level, category]
let scrolls = [];    // from data/scrolls.json
let scrollById = new Map();

const state = {
  item: null,        // { id, name, level, cat }
  base: {},          // stat -> base value
  slots: 0,
  clean: {},         // stat -> rolled clean value
  keyStat: "",
  left: 0,           // upgrade slots still open
  rows: [],          // scrolls that passed: { scroll, successes }
};

// ---------- data ----------

// Stats live in data/equips.json.
async function loadMeta(id) {
  const e = equips.find((x) => x[0] === id);
  if (!e) throw new Error(`unknown item ${id}`);
  return { slots: e[4], base: e[5] || {} };
}

// Hide a broken icon instead of showing a torn image.
document.addEventListener("error", (e) => {
  if (e.target.tagName === "IMG") e.target.style.visibility = "hidden";
}, true);

// ---------- item search: free text, category chips and class filter (js/itemsearch.js) ----------

const search = $("itemSearch"), results = $("itemResults");
const picker = itemSearch({
  cats: $("cats"), input: search, results, job: $("jobFilter"), idPrefix: "opt",
  onPick: (e) => pickItem(e[0]),
  isPicked: () => !!state.item && search.value === state.item.name,
});
const showResults = picker.showResults;

// ---------- pick an item ----------

async function pickItem(id, restore = null) {
  const e = equips.find((x) => x[0] === id);
  if (!e) return;
  results.hidden = true;
  search.value = e[1];
  search.blur();
  state.item = { id: e[0], name: e[1], level: e[2], cat: e[3] };
  $("itemInfo").hidden = false;
  $("itemInfo").innerHTML = `<img src="${icon(id)}" alt="" /><div><div class="name">${esc(e[1])}</div><div class="sub">Loading stats…</div></div>`;

  let meta;
  try { meta = await loadMeta(id); }
  catch {
    $("itemInfo").querySelector(".sub").textContent = "Couldn't load this item's stats. Try again in a moment.";
    return;
  }
  if (state.item?.id !== id) return; // picked something else meanwhile

  state.base = meta.base;
  state.slots = meta.slots;
  state.clean = { ...meta.base, ...(restore?.clean || {}) };
  state.keyStat = defaultKeyStat(id, meta.base);
  state.rows = restore?.rows || [];
  state.left = Math.min(meta.slots, restore?.left ?? meta.slots);

  const baseText = plusList(meta.base) || "no stats";
  $("itemInfo").innerHTML = `<img src="${icon(id)}" alt="" />
    <div><div class="name">${esc(e[1])}</div>
    <div class="sub">Lv ${e[2]} · ${esc(e[3])} · ${meta.slots} slots · ${esc(baseText)}</div></div>`;

  renderRolls();
  closePicker();
  renderRows();
  renderCleanPrice();
  $("slotsLeft").max = state.slots;
  $("slotsLeft").value = state.left;
  for (const id of ["cleanField", "rollCard", "scrollCard", "resultCard"]) $(id).hidden = false;
  update();
}

// The stat whose clean roll sets how rare the item is: attack on weapons, the main stat elsewhere.
function defaultKeyStat(id, base) {
  const isWeapon = Math.floor(id / 10000) >= 130;
  if (isWeapon) return (base.MAD || 0) > (base.PAD || 0) ? "MAD" : (base.PAD ? "PAD" : "");
  return ["PAD", "MAD", "STR", "DEX", "INT", "LUK", "ACC", "EVA", "Speed", "Jump"].find((k) => base[k])
    || STATS.map(([k]) => k).find((k) => base[k]) || ""; // e.g. gloves with only W.DEF
}

// ---------- clean roll sliders ----------

const rollNote = (k) => {
  const p = rollAtLeast(k, state.base[k], state.clean[k]);
  return p >= 0.999 ? "any roll" : `top ${Math.max(1, Math.round(p * 100))}% of drops`;
};

function renderRolls() {
  const keys = STATS.map(([k]) => k).filter((k) => state.base[k]);
  const box = $("rolls");
  if (!keys.length) {
    box.innerHTML = `<p class="hint">This item has no stats that roll.</p>`;
    return;
  }
  box.innerHTML = keys.map((k) => {
    const [lo, hi] = statRange(k, state.base[k]);
    return `<div class="roll">
      <span class="lbl">${STAT_LABEL[k]}</span>
      <input type="range" min="${lo}" max="${hi}" value="${state.clean[k]}" data-k="${k}" aria-label="${STAT_LABEL[k]}" />
      <span class="val"><span>${state.clean[k]}</span><small>${lo}–${hi}</small></span>
      <span class="note${k === state.keyStat ? " key" : ""}" data-note="${k}">${rollNote(k)}${k === state.keyStat ? " · counts for the chance" : ""}</span></div>`;
  }).join("");
  box.oninput = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    state.clean[k] = +e.target.value;
    e.target.parentElement.querySelector(".val span").textContent = e.target.value;
    box.querySelector(`[data-note="${k}"]`).textContent = rollNote(k) + (k === state.keyStat ? " · counts for the chance" : "");
    update();
  };
}

// ---------- slots left ----------

function setLeft(v) {
  state.left = Math.max(0, Math.min(state.slots, Math.floor(+v || 0)));
  $("slotsLeft").value = state.left;
  update();
}
$("slotsLeft").addEventListener("change", (e) => setLeft(e.target.value));
$("slotsLeft").addEventListener("input", (e) => { if (e.target.value !== "") setLeft(e.target.value); });
document.querySelector(".slots-left").addEventListener("click", (e) => {
  const step = +e.target.dataset.step;
  if (step) setLeft(state.left + step);
});

// ---------- scroll picker ----------

const scrollIcon = iconUrl;
// Full names match meso.watch ("Gloves Attack Scroll: Intermediate"), so users can find them there.
const shortName = (s) => s.name;
const scrollOdds = (s) => `${s.success}%${s.boom ? `, ${s.boom}% boom on fail` : ""}`;
const scrollsForItem = () => scrolls.filter((s) => s.target === Math.floor(state.item.id / 10000));

function renderPicker() {
  const q = $("pickerSearch").value.trim().toLowerCase();
  const list = scrollsForItem().filter((s) => !q || `${shortName(s)} ${plusList(s.stats)}`.toLowerCase().includes(q));
  $("pickerList").innerHTML = list.length ? list.map((s) => {
    const p = getPrice(s.id);
    return `<li><button type="button" class="pick" data-id="${s.id}">
      <img src="${scrollIcon(s.id)}" alt="" />
      <span class="nm"><b>${esc(shortName(s))}</b><small>${esc(scrollOdds(s))} · ${esc(plusList(s.stats))}</small></span>
      <span class="pr">${p ? rangeText(p.lo, p.hi) : ""}</span></button></li>`;
  }).join("") : `<li class="empty">No scrolls for this item type.</li>`;
}

function openPicker() {
  $("picker").hidden = false;
  $("openPicker").hidden = true;
  $("pickerSearch").value = "";
  renderPicker();
  $("pickerSearch").focus();
}
function closePicker() {
  $("picker").hidden = true;
  $("openPicker").hidden = false;
}

$("openPicker").addEventListener("click", openPicker);
$("pickerSearch").addEventListener("input", renderPicker);
$("pickerSearch").addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
$("pickerList").addEventListener("click", (e) => {
  const li = e.target.closest("[data-id]");
  if (!li) return;
  const s = scrollById.get(+li.dataset.id);
  const existing = state.rows.find((r) => r.scroll.id === s.id);
  if (existing) existing.successes++;
  else state.rows.push({ scroll: s, successes: 1 });
  // each passed scroll used a slot
  state.left = Math.max(0, state.left - 1);
  $("slotsLeft").value = state.left;
  closePicker();
  renderRows();
  update();
});

// ---------- passed scrolls ----------

const passedTotal = () => state.rows.reduce((n, r) => n + r.successes, 0);
// A scroll family is one scroll in all its tiers, e.g. "Gloves Attack Scroll" (Lesser … Chaos).
const family = (sc) => sc.name.split(":")[0].trim();
const points = (sc) => Object.values(sc.stats).reduce((a, b) => a + b, 0);

// The common tiers of each scroll on the item. The price is the cheapest way to reach the same result with them,
// whatever was actually used, so two items with the same final stats and slots left get the same price.
const MAIN_TIERS = ["Lesser", "Intermediate"];
function mainTiers() {
  const used = new Set(state.rows.map((r) => r.scroll.id));
  const fams = [...new Set(state.rows.filter((r) => r.successes > 0).map((r) => family(r.scroll)))];
  return scrollsForItem().filter((sc) => fams.includes(family(sc)) && MAIN_TIERS.includes(sc.tier) && !used.has(sc.id));
}
// Not scrolls on the item: other tiers of the same scroll, folded away. With their price, the estimate compares
// making the same result with them, so items with the same final stats get the same price. Optional.
let tiersOpen = false;
function renderMainTiers() {
  const box = $("mainTiers");
  const list = mainTiers();
  const open = tiersOpen || list.some((sc) => getPrice(sc.id));
  const names = list.map((sc) => esc(shortName(sc).split(":").pop().trim())).join(" and ");
  box.innerHTML = list.length ? `<details class="tiers-box"${open ? " open" : ""}>
    <summary><span class="tiers-sum">Optional: compare with the ${names} scroll for a fairer estimate</span></summary>
    <p class="hint">These aren't scrolls on your item. FMCheck checks whether the same result is cheaper to make with them,
      so items with the same final stats get the same price. Leave them empty if you don't know their price.</p>
    ${list.map((sc) => `<div class="scroll-row tier-row" data-id="${sc.id}">
      <img src="${scrollIcon(sc.id)}" alt="" />
      <span class="nm"><b>${esc(shortName(sc))}</b><small>${esc(scrollOdds(sc))} · ${esc(plusList(sc.stats))}</small></span><span></span>
      <span class="row-price price-input">${rangeFields(getPrice(sc.id), "k")}
        <a href="${priceLink(sc.id, sc.name)}" data-name="${esc(sc.name)}" target="_blank" rel="noopener">check price ↗</a></span>
    </div>`).join("")}</details>` : "";
  box.querySelector("details")?.addEventListener("toggle", (e) => { tiersOpen = e.target.open; });
}
function onTierPrice(e) {
  if (!["price", "unit"].includes(e.target.dataset.f)) return;
  const row = e.target.closest(".tier-row");
  setPrice(+row.dataset.id, readFields(row));
  update();
}

function renderRows() {
  const box = $("scrollRows");
  renderMainTiers();
  if (!state.rows.length) {
    box.innerHTML = `<p class="hint">None yet. A clean item works too.</p>`;
    return;
  }
  box.innerHTML = state.rows.map((r, i) => {
    const p = getPrice(r.scroll.id);
    return `<div class="scroll-row" data-i="${i}">
      <img src="${scrollIcon(r.scroll.id)}" alt="" />
      <span class="nm"><b>${esc(shortName(r.scroll))}</b><small>${esc(scrollOdds(r.scroll))} · ${esc(plusList(r.scroll.stats))}</small></span>
      <span class="stepper small">
        <button type="button" class="step" data-act="minus" aria-label="One less">−</button>
        <span class="count" ${r.successes ? "" : 'title="Used, but every one failed"'}>×${r.successes}</span>
        <button type="button" class="step" data-act="plus" aria-label="One more">+</button>
        <button type="button" class="step" data-act="remove" aria-label="Remove this scroll">✕</button>
      </span>
      <span class="row-price price-input">
        ${rangeFields(p, "m")}
        <a href="${priceLink(r.scroll.id, r.scroll.name)}" data-name="${esc(r.scroll.name)}" target="_blank" rel="noopener">check price ↗</a></span>
      </div>`;
  }).join("");
}

function onScrollPrice(e) {
  if (!["price", "unit"].includes(e.target.dataset.f)) return;
  const row = e.target.closest(".scroll-row");
  setPrice(state.rows[+row.dataset.i].scroll.id, readFields(row));
  update();
}
$("scrollRows").addEventListener("input", onScrollPrice);
$("mainTiers").addEventListener("input", onTierPrice);
$("mainTiers").addEventListener("change", onTierPrice);
$("scrollRows").addEventListener("change", onScrollPrice);

$("scrollRows").addEventListener("click", (e) => {
  const act = e.target.dataset.act;
  const row = e.target.closest(".scroll-row");
  if (!act || !row) return;
  const i = +row.dataset.i, r = state.rows[i];
  if (act === "plus") {
    r.successes++;
    state.left = Math.max(0, state.left - 1);
  } else if (act === "minus" && r.successes > 0) {
    // ×0 stays: "used, but it failed every time", so the price knows which scroll and its cost.
    r.successes--;
    state.left = Math.min(state.slots, state.left + 1);
  } else if (act === "remove" || act === "minus") {
    state.left = Math.min(state.slots, state.left + r.successes);
    state.rows.splice(i, 1);
  }
  $("slotsLeft").value = state.left;
  renderRows();
  update();
});

// ---------- clean price ----------

// The clean price depends on the rolled stats, so it isn't remembered between items.
let cleanPrice = null; // { lo, hi } or null
function renderCleanPrice() {
  cleanPrice = null;
  $("cleanPrice").innerHTML = rangeFields(null, "k");
  $("cleanLink").href = priceLink(state.item.id, state.item.name);
  $("cleanLink").dataset.name = state.item.name;
}
function onCleanPrice() {
  cleanPrice = readFields($("cleanPrice"));
  update();
}
$("cleanPrice").addEventListener("input", onCleanPrice);
$("cleanPrice").addEventListener("change", onCleanPrice);

// ---------- check price: also copy the name for meso.watch's filter ----------

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-name]");
  if (!a) return;
  // The link still opens; copying runs alongside it.
  navigator.clipboard?.writeText(a.dataset.name)
    .then(() => toast(`"${a.dataset.name}" copied. On meso.watch press / and paste.`))
    .catch(() => {});
});

// ---------- result ----------

// Chance of an item like this: a clean drop rolls the main stat this high, and the scrolls pass like this.
function renderOdds(failed) {
  const box = $("odds");
  if (failed < 0) { box.innerHTML = ""; return null; }
  const k = state.keyStat;
  const roll = k ? rollAtLeast(k, state.base[k], state.clean[k]) : 1;
  // Failed slots aren't entered: spread them over the passed scrolls in the most likely way.
  const types = state.rows.map((r) => ({ successes: r.successes, success: r.scroll.success, boom: r.scroll.boom }));
  const fails = allocateFailures(types, Math.max(0, failed));
  const scroll = state.rows.reduce((c, r, i) => c * groupOdds(r.successes + fails[i], r.successes, r.scroll.success, r.scroll.boom), 1);
  const chance = roll * scroll;
  const pct = (x) => (x >= 0.995 ? "100%" : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toPrecision(2)}%`);
  const oneIn = chance > 0 ? 1 / chance : Infinity;
  const oneInText = oneIn < 1.05 ? "almost every try" : `1 in ${oneIn < 1e6 ? Math.round(oneIn).toLocaleString("en-US") : mesos(oneIn)}`;
  box.innerHTML = `
    <div class="odds-main"><span>Chance of an item like this</span><b>${pct(chance)}</b><small>${oneInText}</small></div>
    <div class="breakdown">
      ${k ? `<span>Clean ${STAT_LABEL[k]} ${state.clean[k]} or better</span><span>${pct(roll)}</span>` : ""}
      <span>Scrolls pass like this${failed > 0 && state.rows.length ? ` (${failed} failed)` : ""}</span><span>${pct(scroll)}</span>
    </div>`;
  return { chance, oneIn };
}

function update() {
  if (!state.item) return;
  const used = state.slots - state.left;
  const passed = passedTotal();
  const failed = used - passed;
  $("slotInfo").innerHTML = failed < 0
    ? `<span class="warn">more passed scrolls than used slots</span>`
    : `${used} used · ${passed} passed · ${failed} failed`;

  const groups = state.rows.map((r) => ({ successes: r.successes, stats: r.scroll.stats }));
  const fin = finalStats(state.clean, groups);

  const odds = renderOdds(failed);
  saveHash();
  const price = failed < 0 ? null : renderEstimate(used);
  lastEstimate = price;
  lastOdds = odds;
  renderCard(fin, odds, price);
}

// The price estimate; returns { lo, hi } or null when it can't be worked out yet.
function renderEstimate(used) {
  const out = $("estimate");
  if (!cleanPrice) { out.innerHTML = `<p class="hint">Want an estimate? Enter the clean item price (step 1) and the scroll prices. It's optional: you can publish the item without it.</p>`; return null; }

  // What the item gained, per scroll family, and the scrolls the user entered (with a price).
  const needs = {};
  for (const r of state.rows) needs[family(r.scroll)] = (needs[family(r.scroll)] || 0) + r.successes * points(r.scroll);
  const tiersAt = (end) => [...state.rows.map((r) => r.scroll), ...mainTiers()].map((sc) => ({
    id: sc.id, fam: family(sc), points: points(sc), success: sc.success, boom: sc.boom, price: getPrice(sc.id)?.[end],
  })).filter((t) => Number.isFinite(t.price));
  const pointsGained = Object.values(needs).reduce((a, b) => a + b, 0);

  const failed = used - passedTotal();

  // Worked out with the "lo" and "hi" ends; with one price per field they're the same.
  const run = (end) => {
    const clean = cleanPrice[end], tiers = tiersAt(end);
    if (!pointsGained && failed > 0) {
      // Nothing passed: a clean item that lost part of its slots (see failedItemValue).
      const f = failedItemValue({ cleanPrice: clean, slots: state.slots, left: state.left });
      return { cost: clean, open: 0, value: f.value, lost: clean - f.value, ratio: f.ratio, cleanItems: 1, uses: {}, tiers };
    }
    const route = cheapestRoute({ cleanPrice: clean, slots: used, needs, tiers });
    if (!route) return null;
    // Open slots: the chance to scroll them further (see openSlotsBonus), for the main scroll on the item.
    const fam = Object.keys(needs).sort((a, b) => needs[b] - needs[a])[0];
    const open = fam ? openSlotsBonus({ cleanPrice: clean, slots: state.slots, left: state.left, fam, gained: needs[fam], tiers }) : 0;
    return { ...route, open, value: route.cost + open, tiers };
  };
  const lo = run("lo"), hi = run("hi");
  const unpriced = state.rows.filter((r) => !getPrice(r.scroll.id)).map((r) => esc(shortName(r.scroll)));
  const tiersMissing = mainTiers().filter((sc) => !getPrice(sc.id)).map((sc) => esc(shortName(sc)));
  if (!lo || !hi) {
    out.innerHTML = `<p class="hint">${unpriced.length ? `Enter a price for ${unpriced.join(", ")} to get an estimate.` : "Enter the scroll prices to get an estimate."}</p>`;
    return null;
  }

  const byId = new Map(scrolls.map((sc) => [sc.id, sc]));
  const plan = Object.entries(lo.uses).sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${n.toFixed(1)}× ${esc(shortName(byId.get(+id)).split(":").pop().trim())}`).join(", ");
  const pct = (x) => (x >= 0.995 ? "100%" : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toPrecision(2)}%`);
  const items = (n) => (n < 1e6 ? (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US")) : mesos(n));
  out.innerHTML = `
    <p class="label">Price breakdown${lo.value === hi.value ? "" : ` · midpoint ≈ ${mesos((lo.value + hi.value) / 2)}`}</p>
    <div class="breakdown">
      ${lo.lost != null ? `<span>Clean item price</span><span>${rangeText(lo.cost, hi.cost)}</span>
      <span>${failed} failed slot${failed > 1 ? "s" : ""} (keeps ${Math.round(lo.ratio * 100)}%)</span><span>−${rangeText(lo.lost, hi.lost)}</span>`
      : `<span>Cheapest way to make one</span><span>${rangeText(lo.cost, hi.cost)}</span>
      ${state.left > 0 ? `<span>${state.left} open slot${state.left > 1 ? "s" : ""} (chance to scroll more)</span><span>${hi.open > 0 ? "+" + rangeText(lo.open, hi.open) : "+0 (scrolling them wouldn't pay off at these prices)"}</span>` : ""}
      ${pointsGained ? `<span>Clean items the cheapest way uses</span><span>${items(lo.cleanItems)}</span>
      <span>Scrolls per clean item</span><span>${plan || "–"}</span>` : ""}`}
    </div>
    ${unpriced.length ? `<p class="warn">No price for ${unpriced.join(", ")}: left out of the cheapest way.</p>` : ""}
    ${tiersMissing.length ? `<p class="hint">Optional: for a fairer estimate, add today's price of ${tiersMissing.join(" and ")} under Scrolls ("compare with").</p>` : ""}`;
  return { lo: lo.value, hi: hi.value };
}

let lastEstimate = null, lastOdds = null; // for publishing

// ---------- put the item up on the Market ----------

let pubUser = null;
async function setupPublish() {
  $("publish").hidden = false;
  const m = await me();
  showPublish(m.user);
}
function showPublish(user) {
  pubUser = user;
  $("pubSignIn").hidden = !!user;
  $("pubForm").hidden = !user;
  if (!user) { googleButton($("pubSignIn"), showPublish); return; }
  $("pubIgnRow").hidden = !!user.ign;
}

$("pubForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("pubMsg");
  msg.textContent = "";
  if (!state.item) return;
  if (state.slots - state.left < passedTotal()) { msg.textContent = "Fix the slots first: more passed scrolls than used slots."; return; }
  const priceText = $("pubPrice").value.trim();
  const price = readPrice(priceText, $("pubUnit").value);
  if (!priceText) { msg.textContent = "Enter your asking price, e.g. 350 M."; $("pubPrice").focus(); return; }
  if (!(price > 0)) { msg.textContent = "The price doesn't look right, e.g. 350 M."; return; }
  $("pubSend").disabled = true;
  try {
    if (!pubUser.ign) {
      const ign = $("pubIgn").value.trim();
      if (!validIgn(ign)) throw new Error("In-game name: 2–13 letters or numbers.");
      pubUser = (await api("/api/me", { method: "PUT", body: { ign } })).user;
      $("pubIgnRow").hidden = true;
    }
    msg.textContent = "Publishing…";
    const j = await api("/api/listings", { method: "POST", body: {
      item: state.item.id, clean: state.clean, left: state.left,
      scrolls: state.rows.map((r) => ({ id: r.scroll.id, n: r.successes })),
      chance: lastOdds ? lastOdds.chance : 1, estimate: lastEstimate,
      price, channel: $("pubChannel").value.trim(), room: $("pubRoom").value.trim(), note: $("pubNote").value.trim(),
      image: $("card").toDataURL("image/png"),
    } });
    const link = `${location.origin}/community.html#l=${j.id}`;
    msg.innerHTML = `Published! <a href="community.html#l=${j.id}">See it on the community page</a>
      · <button type="button" class="ghost-btn" id="pubCopy">Copy link</button>`;
    $("pubCopy").addEventListener("click", () => navigator.clipboard.writeText(link).then(() => toast("Link copied.")).catch(() => {}));
  } catch (err) {
    msg.innerHTML = esc(err.message) + (err.upsell ? ` <a class="sup-link" href="community.html#supporters"><img class="ic" src="assets/ui/starpiece.png" alt="" /> Become a supporter</a>` : "");
    if (err.status === 401) { pubUser = null; showPublish(null); }
  } finally {
    $("pubSend").disabled = false;
  }
});

// ---------- result card (in-game tooltip style) ----------

function renderCard(fin, odds, price) {
  const e = equips.find((x) => x[0] === state.item.id);
  const d = cardInfo({
    equip: e,
    fin,
    clean: state.clean,
    left: state.left,
    upgrades: passedTotal(),
    price,
    priceHint: !cleanPrice ? "Enter the clean item price"
      : state.rows.some((r) => !getPrice(r.scroll.id)) ? `Enter a price for ${shortName(state.rows.find((r) => !getPrice(r.scroll.id)).scroll).split(":").pop().trim()} scrolls`
      : "Check the prices you entered",
    chance: odds ? odds.chance : 1,
    oneIn: odds ? odds.oneIn : 1,
    scrolls: state.rows.map((r) => ({ n: r.successes, name: shortName(r.scroll) })),
    footer: "From that day's prices · not a guarantee",
  });
  $("card").setAttribute("aria-label", cardLabel(d));
  drawCard($("card"), d, cardFmt);
}

const cardFile = async () => {
  const blob = await cardBlob($("card"));
  return new File([blob], `fmcheck-${state.item.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, { type: "image/png" });
};
$("cardDownload").addEventListener("click", async () => {
  const f = await cardFile();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("cardCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": cardBlob($("card")) })]);
    toast("Image copied. Paste it in Discord or anywhere.");
  } catch { toast("Couldn't copy here. Use Download instead."); }
});
$("cardShare").addEventListener("click", async () => {
  const f = await cardFile();
  try { await navigator.share({ files: [f], title: `${state.item.name} · FMCheck`, url: location.href }); }
  catch { /* closed or not supported */ }
});
if (!(navigator.canShare && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] }))) $("cardShare").hidden = true;

// ---------- shareable address: #i=<id>&r=PAD.50,STR.3&l=2&s=2043001.5,... ----------

function saveHash() {
  const r = Object.entries(state.clean).filter(([k, v]) => v !== state.base[k]).map(([k, v]) => `${k}.${v}`).join(",");
  const s = state.rows.map((x) => `${x.scroll.id}.${x.successes}`).join(",");
  const q = new URLSearchParams({ i: state.item.id });
  if (r) q.set("r", r);
  if (state.left !== state.slots) q.set("l", state.left);
  if (s) q.set("s", s);
  history.replaceState(null, "", `#${q}`);
}

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const id = +q.get("i");
  if (!id) return null;
  const clean = {};
  for (const part of (q.get("r") || "").split(",").filter(Boolean)) {
    const [k, v] = part.split(".");
    if (STAT_LABEL[k] && Number.isFinite(+v)) clean[k] = +v;
  }
  const rows = (q.get("s") || "").split(",").filter(Boolean).map((part) => {
    const [sid, ok] = part.split(".").map(Number);
    const scroll = scrollById.get(sid);
    return scroll && ok > 0 && { scroll, successes: ok };
  }).filter(Boolean);
  return { id, restore: { clean, rows, left: q.has("l") ? +q.get("l") : undefined } };
}

// ---------- How it works: a short guide that plays real frames from the site ----------

const GUIDE = [
  ["assets/guide/1.webp?v=4", "1. Pick your item: search it, or tap a category and a class to browse."],
  ["assets/guide/2.webp?v=4", "2. Set its clean stats. For a price estimate, also enter what a clean one costs today (one average price). Tip: tap \"check price\" to see it on meso.watch."],
  ["assets/guide/3.webp?v=4", "3. Set the slots left and add the scrolls that passed (failed ones are worked out for you). For the estimate, add each scroll's price too."],
  ["assets/guide/4.webp?v=4", "4. See the odds of an item like this and, with prices, an estimate to help you set your price. Save the item card to share it."],
  ["assets/guide/5.webp?v=4", "5. Put it in the spotlight: sign in with Google and publish the item for sale. You set the price; the prices above aren't needed to publish: the estimate is only there to help."],
  ["assets/guide/6.webp?v=4", "6. The Market: buyers see each item's exact stats, slots, odds and how the price compares with the estimate, and can filter by stat. Featured items sit on top."],
  ["assets/guide/7.webp?v=4", "7. Tap an item to see its full card, the seller and where to find them (channel, FM room). Checked on screen: the seller showed the item from the game."],
  ["assets/guide/8.webp?v=4", "8. Under My items: keep it up with Still selling, check it on screen, edit the price, mark it sold, or feature it for 24 hours (supporters)."],
];
const GUIDE_KEY = "fmcheck-guide-seen";
let guideStep = 0, guideTimer = null;
const stillMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("a11y-still");
for (const [src] of GUIDE) { const i = new Image(); i.src = src; } // load all frames up front

function showGuideStep(n) {
  guideStep = (n + GUIDE.length) % GUIDE.length;
  const img = $("guideImg");
  img.classList.remove("play");
  void img.offsetWidth; // restart the animation
  img.src = GUIDE[guideStep][0];
  img.alt = GUIDE[guideStep][1];
  img.classList.add("play");
  $("guideCaption").textContent = GUIDE[guideStep][1];
  for (const d of document.querySelectorAll(".guide-dots button")) d.setAttribute("aria-current", String(+d.dataset.step === guideStep));
}
function guideAuto(on) {
  clearInterval(guideTimer);
  if (on && !stillMotion()) guideTimer = setInterval(() => showGuideStep(guideStep + 1), 4200);
}
function openGuide() {
  $("guide").hidden = false;
  $("guideBtn").setAttribute("aria-expanded", "true");
  showGuideStep(0);
  guideAuto(true);
}
function closeGuide(focusSearch) {
  $("guide").hidden = true;
  $("guideBtn").setAttribute("aria-expanded", "false");
  guideAuto(false);
  try { localStorage.setItem(GUIDE_KEY, "1"); } catch { /* fine */ }
  if (focusSearch) search.focus();
}
$("guideBtn").addEventListener("click", () => ($("guide").hidden ? openGuide() : closeGuide(false)));
$("guideClose").addEventListener("click", () => closeGuide(false));
$("guideGo").addEventListener("click", () => closeGuide(true));
$("guidePrev").addEventListener("click", () => { showGuideStep(guideStep - 1); guideAuto(false); });
$("guideNext").addEventListener("click", () => { showGuideStep(guideStep + 1); guideAuto(false); });
document.querySelector(".guide-dots").addEventListener("click", (e) => {
  if (e.target.dataset.step != null) { showGuideStep(+e.target.dataset.step); guideAuto(false); }
});
// first visit (and not opening a shared calculation): show the guide
try { if (!localStorage.getItem(GUIDE_KEY) && !location.hash.includes("i=")) openGuide(); } catch { /* storage off: skip */ }

setupA11y();

// ---------- start ----------

for (const a of document.querySelectorAll("[data-discord]")) a.href = DISCORD_URL;
if (DONATE_URL) {
  for (const a of document.querySelectorAll("[data-donate]")) { a.href = DONATE_URL; a.hidden = false; }
}

(async function start() {
  const [eq, sc] = await Promise.all([
    fetch("data/equips.json").then((r) => r.json()),
    fetch("data/scrolls.json").then((r) => r.json()),
  ]);
  equips = eq;
  scrolls = sc;
  scrollById = new Map(sc.map((s) => [s.id, s]));
  picker.setEquips(eq);
  $("equipNames").innerHTML = eq.map((e) => `<option value="${esc(e[1])}"></option>`).join("");
  health().then((j) => { if (j.community) setupPublish(); });
  const h = readHash();
  if (h) pickItem(h.id, h.restore);
  else if (search.value.trim()) showResults(); // typed before the list loaded
})();
