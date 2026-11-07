import { iconUrl, priceLink, DONATE_URL, DISCORD_URL } from "./config.js?v=f6f72e36";
import { STATS, STAT_LABEL, statRange, rollAtLeast, groupOdds, allocateFailures, finalStats, openSlotsBonus, cheapestRoute, failedItemValue, mesos, UNITS, readRange, readPrice } from "./calc.js?v=f6f72e36";
import { getPrice, setPrice } from "./prices.js?v=f6f72e36";
import { drawCard, cardBlob } from "./card.js?v=f6f72e36";
import { cardInfo, cardLabel, cardFmt } from "./itemcard.js?v=f6f72e36";
import { setupA11y } from "./a11y.js?v=f6f72e36";
import { API, api, health, me, googleButton, validIgn } from "./account.js?v=f6f72e36";

const $ = (id) => document.getElementById(id);
const icon = iconUrl;
const rangeText = (lo, hi) => (lo === hi ? mesos(lo) : `${mesos(lo)} – ${mesos(hi)}`);

// Price range fields: "from" and "to" boxes sharing one unit dropdown.
// `p` is a saved { lo, hi } to fill in, or null; `unit` is the default unit.
function rangeFields(p, unit) {
  let from = "", to = "";
  if (p) {
    const u = UNITS.slice().reverse().find(([, , m]) => m > 1 && p.hi >= m) || UNITS[0];
    unit = u[0];
    const num = (v) => String(+(v / u[2]).toPrecision(6));
    from = num(p.lo);
    to = p.hi !== p.lo ? num(p.hi) : "";
  }
  return `<input inputmode="decimal" placeholder="from" aria-label="Lowest price" value="${from}" data-f="from" />
    <span class="dash">–</span>
    <input inputmode="decimal" placeholder="to" aria-label="Highest price" value="${to}" data-f="to" />
    ${unitSelect(unit, 'data-f="unit"')}`;
}
const readFields = (box) => readRange(
  box.querySelector('[data-f="from"]').value, box.querySelector('[data-f="to"]').value, box.querySelector('[data-f="unit"]').value);
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

// ---------- item search: free text, category chips and class filter ----------

const search = $("itemSearch"), results = $("itemResults");
let matches = [], active = 0, hideTimer;
const filter = { cat: "", job: "" };

// Categories like the game's equip tabs. Icon = a typical item of that kind.
const CATS = [["", "All", null], ["Weapon", "Weapons", 1302000], ["Hat", "Hats", 1002012], ["Top", "Tops", 1040002],
  ["Bottom", "Bottoms", 1060001], ["Overall", "Overalls", 1050010], ["Shoes", "Shoes", 1072083], ["Glove", "Gloves", 1082000],
  ["Shield", "Shields", 1092001], ["Cape", "Capes", 1102000], ["Earring", "Earrings", 1032007]];
const catOf = (e) => (Math.floor(e[0] / 10000) >= 130 ? "Weapon" : e[3]);
const jobOk = (e) => !filter.job || !(e[6] && e[6].jobs) || e[6].jobs.includes(filter.job);
const inFilter = (e) => (!filter.cat || catOf(e) === filter.cat) && jobOk(e);

function renderCats() {
  $("cats").innerHTML = CATS.map(([key, label, id]) => {
    const n = equips.filter((e) => (!key || catOf(e) === key) && jobOk(e)).length;
    return `<button type="button" class="cat${filter.cat === key ? " on" : ""}" data-cat="${key}" title="${label}" aria-label="${label} ${n} items" aria-pressed="${filter.cat === key}">
      ${id ? `<img src="${icon(id)}" alt="" />` : `<span class="all">ALL</span>`} <small>${n}</small></button>`;
  }).join("");
}

// Text: name starts with it, then a word in the name starts with it, then anywhere (also the item type, e.g. "claw").
// No text but a category or class picked: list them all by level.
function findItems(q) {
  q = q.trim().toLowerCase();
  const pool = equips.filter(inFilter);
  if (!q) return filter.cat || filter.job ? pool.slice().sort((a, b) => a[2] - b[2] || a[1].localeCompare(b[1])).slice(0, 300) : [];
  const starts = [], word = [], has = [];
  for (const e of pool) {
    const n = e[1].toLowerCase(), t = e[3].toLowerCase();
    if (n.startsWith(q)) starts.push(e);
    else if (n.includes(" " + q) || n.includes("-" + q) || t.startsWith(q)) word.push(e);
    else if (q.length > 1 && (n.includes(q) || t.includes(q))) has.push(e);
  }
  return starts.concat(word, has).slice(0, 60);
}

function showResults() {
  clearTimeout(hideTimer);
  matches = findItems(search.value);
  active = 0;
  results.hidden = !matches.length && !(filter.cat || filter.job || search.value.trim());
  search.setAttribute("aria-expanded", String(!results.hidden));
  if (matches.length) search.setAttribute("aria-activedescendant", "opt-0"); else search.removeAttribute("aria-activedescendant");
  results.innerHTML = matches.length ? matches.map((e, i) =>
    `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === 0}">
      <img loading="lazy" src="${icon(e[0])}" alt="" /><span>${esc(e[1])}</span>
      <span class="meta">Lv ${e[2]} · ${esc(e[3])}</span></li>`).join("")
    : `<li class="none" role="option" aria-disabled="true">No items match. Try another category or class.</li>`;
}

function moveActive(d) {
  if (!matches.length) return;
  active = (active + d + matches.length) % matches.length;
  [...results.children].forEach((li, i) => li.setAttribute("aria-selected", i === active));
  search.setAttribute("aria-activedescendant", `opt-${active}`);
  results.children[active].scrollIntoView({ block: "nearest" });
}

search.addEventListener("input", showResults);
search.addEventListener("focus", () => { if (filter.cat || filter.job || search.value.trim()) showResults(); });
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
  else if (e.key === "Enter" && matches[active]) { e.preventDefault(); pickItem(matches[active][0]); }
  else if (e.key === "Escape") { results.hidden = true; search.setAttribute("aria-expanded", "false"); }
});
results.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-i]");
  if (li) { e.preventDefault(); pickItem(matches[+li.dataset.i][0]); }
});
search.addEventListener("blur", () => {
  hideTimer = setTimeout(() => { results.hidden = true; search.setAttribute("aria-expanded", "false"); }, 150);
});

// Chips keep the focus in the search box, so the list stays open while browsing.
$("cats").addEventListener("mousedown", (e) => { if (e.target.closest(".cat")) e.preventDefault(); });
$("cats").addEventListener("click", (e) => {
  const b = e.target.closest(".cat");
  if (!b) return;
  filter.cat = filter.cat === b.dataset.cat ? "" : b.dataset.cat;
  renderCats();
  if (state.item && search.value === state.item.name) search.value = ""; // browsing again after a pick
  search.focus();
  showResults();
});
$("jobFilter").addEventListener("change", (e) => {
  filter.job = e.target.value;
  renderCats();
  if (state.item && search.value === state.item.name) search.value = "";
  search.focus();
  showResults();
});

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
function renderMainTiers() {
  const box = $("mainTiers");
  const list = mainTiers();
  box.innerHTML = list.length ? `<p class="label">Also needed, so only the result counts: today's price of the common tiers</p>
    ${list.map((sc) => `<div class="scroll-row tier-row" data-id="${sc.id}">
      <img src="${scrollIcon(sc.id)}" alt="" />
      <span class="nm"><b>${esc(shortName(sc))}</b><small>${esc(scrollOdds(sc))} · ${esc(plusList(sc.stats))}</small></span><span></span>
      <span class="row-price price-input">${rangeFields(getPrice(sc.id), "k")}
        <a href="${priceLink(sc.id, sc.name)}" data-name="${esc(sc.name)}" target="_blank" rel="noopener">check price ↗</a></span>
    </div>`).join("")}` : "";
}
function onTierPrice(e) {
  if (!["from", "to", "unit"].includes(e.target.dataset.f)) return;
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
  if (!["from", "to", "unit"].includes(e.target.dataset.f)) return;
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
  if (salesOn) { if (salesFor !== state.item.id) loadSales(); else renderSales(); }
}

// The price estimate; returns { lo, hi } or null when it can't be worked out yet.
function renderEstimate(used) {
  const out = $("estimate");
  if (!cleanPrice) { out.innerHTML = `<p class="hint">Enter the clean item price (step 1) to get an estimate.</p>`; return null; }

  // What the item gained, per scroll family, and the scrolls the user entered (with a price).
  const needs = {};
  for (const r of state.rows) needs[family(r.scroll)] = (needs[family(r.scroll)] || 0) + r.successes * points(r.scroll);
  const tiersAt = (end) => [...state.rows.map((r) => r.scroll), ...mainTiers()].map((sc) => ({
    id: sc.id, fam: family(sc), points: points(sc), success: sc.success, boom: sc.boom, price: getPrice(sc.id)?.[end],
  })).filter((t) => Number.isFinite(t.price));
  const pointsGained = Object.values(needs).reduce((a, b) => a + b, 0);

  const failed = used - passedTotal();

  // Worked out twice: with every "from" price, then with every "to" price.
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
    ${tiersMissing.length ? `<p class="hint">Add today's price of ${tiersMissing.join(" and ")} (under Scrolls) so the estimate depends only on the result.</p>` : ""}`;
  return { lo: lo.value, hi: hi.value };
}

// ---------- reported sales ----------
// Players report what they really sold or bought an item for. The list shows the latest reports for the item,
// and the reports are collected to check and tune the formula against the market.

let salesOn = false, salesFor = null, salesData = [], lastEstimate = null, lastOdds = null;

// What the item gained from scrolls, e.g. { PAD: 7 }.
function gainedStats() {
  const g = {};
  for (const r of state.rows) for (const [k, v] of Object.entries(r.scroll.stats)) g[k] = (g[k] || 0) + v * r.successes;
  for (const k of Object.keys(g)) if (!g[k]) delete g[k];
  return g;
}
const sameGain = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};
const ago = (t) => {
  const d = Math.floor((Date.now() - t) / 864e5);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

async function loadSales() {
  const id = state.item.id;
  salesFor = id;
  salesData = [];
  renderSales(true);
  try {
    const r = await fetch(`${API}/api/sales?item=${id}`);
    const j = await r.json();
    if (salesFor === id) { salesData = j.sales || []; renderSales(); }
  } catch { if (salesFor === id) $("salesList").innerHTML = `<p class="hint">Couldn't load reported sales right now.</p>`; }
}

function renderSales(loading = false) {
  $("sales").hidden = !state.item;
  const box = $("salesList");
  if (loading) { box.innerHTML = `<p class="hint">Loading…</p>`; return; }
  if (!salesData.length) { box.innerHTML = `<p class="hint">No sales reported for this item yet. Be the first!</p>`; return; }
  const g = gainedStats();
  const rows = salesData.map((x) => {
    const same = sameGain(x.gained || {}, g) && x.left === state.left;
    const what = Object.keys(x.gained || {}).length ? plusList(x.gained) : "clean";
    const left = x.left != null ? ` · ${x.left} slot${x.left === 1 ? "" : "s"} left` : "";
    return `<li class="${same ? "same" : ""}"><b>${mesos(x.price)}</b><span>${esc(what)}${left}</span>
      <small>${x.kind === "bought" ? "bought" : "sold"} ${ago(x.t)}</small>${same ? `<span class="tag">same as yours</span>` : ""}</li>`;
  });
  box.innerHTML = `<ul>${rows.join("")}</ul>`;
}

$("saleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("saleMsg");
  const price = readPrice($("salePrice").value, $("saleUnit").value);
  if (!state.item || !Number.isFinite(price) || price <= 0) { msg.textContent = "Enter the price, e.g. 350 M."; return; }
  const used = state.slots - state.left;
  if (used < passedTotal()) { msg.textContent = "Fix the slots first: more passed scrolls than used slots."; return; }
  const body = {
    item: state.item.id, price, kind: $("saleKind").value, gained: gainedStats(),
    left: state.left, slots: state.slots,
    scrolls: state.rows.map((r) => ({ id: r.scroll.id, n: r.successes })),
    estimate: lastEstimate,
  };
  $("saleSend").disabled = true;
  msg.textContent = "Sending…";
  try {
    const r = await fetch(`${API}/api/sales`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Couldn't send it, try again later.");
    msg.textContent = "Thanks! Your report was added.";
    $("salePrice").value = "";
    salesFor = null;
    loadSales();
  } catch (err) {
    msg.textContent = err.message || "Couldn't send it, try again later.";
  } finally {
    $("saleSend").disabled = false;
  }
});

// ---------- publish to the community ----------

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
  const price = priceText ? readPrice(priceText, $("pubUnit").value) : null;
  if (priceText && !(price > 0)) { msg.textContent = "The price doesn't look right, e.g. 350 M."; return; }
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
    msg.textContent = err.message;
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
  ["assets/guide/1.webp?v=3", "1. Pick your item: search it, or tap a category and a class to browse."],
  ["assets/guide/2.webp?v=3", "2. Enter what a clean one costs today (from – to), and set its clean stats. Tip: tap \"check price\" to see it on meso.watch."],
  ["assets/guide/3.webp?v=3", "3. Set the slots left, add the scrolls that passed and their price. Failed ones are worked out for you. Tip: check each scroll's price on meso.watch (\"check price\") before you enter the range."],
  ["assets/guide/4.webp?v=3", "4. Get the price range and the odds, and save the item card to share it."],
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
  renderCats();
  $("equipNames").innerHTML = eq.map((e) => `<option value="${esc(e[1])}"></option>`).join("");
  // Sale reports appear only when the server has them switched on.
  health().then((j) => {
    salesOn = !!j.sales;
    if (salesOn && state.item) update();
    if (j.community) setupPublish();
  });
  const h = readHash();
  if (h) pickItem(h.id, h.restore);
  else if (search.value.trim()) showResults(); // typed before the list loaded
})();
