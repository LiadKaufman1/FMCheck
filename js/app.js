import { iconUrl, priceLink, DONATE_URL, DISCORD_URL } from "./config.js?v=dc6b89ff";
import { STATS, STAT_LABEL, statRange, rollAtLeast, inferScrolls, groupOdds, allocateFailures, finalStats, openSlotValue, cheapestRoute, failedItemValue, mesos, UNITS, readRange } from "./calc.js?v=dc6b89ff";
import { getPrice, setPrice } from "./prices.js?v=dc6b89ff";
import { parseTooltip, readImage } from "./reader.js?v=dc6b89ff";
import { drawCard, cardBlob } from "./card.js?v=dc6b89ff";

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
const CATS = [["", "All", null], ["Weapon", "Weapons", 1302000], ["Hat", "Hats", 1002995], ["Top", "Tops", 1040002],
  ["Bottom", "Bottoms", 1060001], ["Overall", "Overalls", 1050000], ["Shoes", "Shoes", 1072001], ["Glove", "Gloves", 1082000],
  ["Shield", "Shields", 1092001], ["Cape", "Capes", 1102000], ["Earring", "Earrings", 1032001]];
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

function renderRows() {
  const box = $("scrollRows");
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
  lastPrice = price;
  renderVerdict();
  renderCard(fin, odds, price);
}

// The price estimate; returns { lo, hi } or null when it can't be worked out yet.
function renderEstimate(used) {
  const out = $("estimate");
  if (!cleanPrice) { out.innerHTML = `<p class="hint">Enter the clean item price ${mode === "f" ? "above" : "(step 1)"} to get an estimate.</p>`; return null; }

  // What the item gained, per scroll family, and the scrolls the user entered (with a price).
  const needs = {};
  for (const r of state.rows) needs[family(r.scroll)] = (needs[family(r.scroll)] || 0) + r.successes * points(r.scroll);
  const tiersAt = (end) => state.rows.map((r) => r.scroll).map((sc) => ({
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
    // Open slots: the buyer can still scroll them. Best priced scroll, valued at this item's mesos per stat point.
    let perSlot = 0;
    for (const t of tiers) {
      perSlot = Math.max(perSlot, openSlotValue({ value: route.cost, cleanPrice: clean, pointsGained, slotsLeft: 1, ref: t }).perSlot);
    }
    return { ...route, open: perSlot * state.left, value: route.cost + perSlot * state.left, tiers };
  };
  const lo = run("lo"), hi = run("hi");
  const unpriced = state.rows.filter((r) => !getPrice(r.scroll.id)).map((r) => esc(shortName(r.scroll)));
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
      ${state.left > 0 ? `<span>${state.left} open slot${state.left > 1 ? "s" : ""} (room to scroll more)</span><span>${hi.open > 0 ? "+" + rangeText(lo.open, hi.open) : "+0 (more scrolls cost about what they add)"}</span>` : ""}
      ${pointsGained ? `<span>Clean items the cheapest way uses</span><span>${items(lo.cleanItems)}</span>
      <span>Scrolls per clean item</span><span>${plan || "–"}</span>` : ""}`}
    </div>
    ${unpriced.length ? `<p class="warn">No price for ${unpriced.join(", ")}: left out of the cheapest way.</p>` : ""}`;
  return { lo: lo.value, hi: hi.value };
}

// ---------- result card (in-game tooltip style) ----------

const GAME_LABEL = { STR: "STR", DEX: "DEX", INT: "INT", LUK: "LUK", MHP: "MaxHP", MMP: "MaxMP", PAD: "Weapon Att.",
  MAD: "Magic Att.", PDD: "Weapon Def.", MDD: "Magic Def.", ACC: "Accuracy", EVA: "Avoidability", Speed: "Speed",
  Jump: "Jump", CRT: "Critical Rate", CRD: "Critical Damage" };
const GAME_ORDER = ["STR", "DEX", "INT", "LUK", "MHP", "MMP", "PAD", "MAD", "PDD", "MDD", "ACC", "EVA", "Speed", "Jump", "CRT", "CRD"];
const cardFmt = {
  range: (lo, hi) => rangeText(lo, hi),
  pct: (x) => (x >= 0.995 ? "100%" : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toPrecision(2)}%`),
  oneIn: (n) => (n < 1.05 ? "almost every try" : `1 in ${n < 1e6 ? Math.round(n).toLocaleString("en-US") : mesos(n)}`),
};

function renderCard(fin, odds, price) {
  const e = equips.find((x) => x[0] === state.item.id) || [];
  const statText = GAME_ORDER.filter((k) => fin[k]).map((k) => `${GAME_LABEL[k]} ${fin[k]}`).join(", ");
  $("card").setAttribute("aria-label", `${state.item.name}${passedTotal() ? ` (+${passedTotal()})` : ""}: ${statText || "no stats"}, `
    + `${state.left} slots left. Estimated price ${price ? rangeText(price.lo, price.hi) : "not available yet"}. `
    + `Chance of an item like this ${odds ? cardFmt.pct(odds.chance) : "unknown"}.`);
  const extra = e[6] || {};
  drawCard($("card"), {
    name: state.item.name,
    upgrades: passedTotal(),
    icon: icon(state.item.id),
    level: state.item.level || 0,
    req: extra.req || [0, 0, 0, 0],
    jobs: extra.jobs || null,
    type: state.item.cat,
    stats: GAME_ORDER.filter((k) => fin[k]).map((k) => ({
      label: GAME_LABEL[k], total: fin[k], base: state.clean[k] || 0, gain: fin[k] - (state.clean[k] || 0),
    })),
    left: state.left,
    price,
    priceHint: !cleanPrice ? "Enter the clean item price"
      : state.rows.some((r) => !getPrice(r.scroll.id)) ? `Enter a price for ${shortName(state.rows.find((r) => !getPrice(r.scroll.id)).scroll).split(":").pop().trim()} scrolls`
      : "Check the prices you entered",
    date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    chance: odds ? odds.chance : 1,
    oneIn: odds ? odds.oneIn : 1,
    scrolls: state.rows.map((r) => ({ n: r.successes, name: shortName(r.scroll) })),
    footer: "From that day's prices · not a guarantee",
  }, cardFmt);
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
  if (mode === "f") q.set("m", "f");
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

// ---------- "Price my finished item": the game's tooltip, typed in or read from a screenshot ----------
//
// The tooltip shows "Name (+passes)", each stat as "+total" or "+total (clean +gain)", and "Remaining Enhancements".
// From that we work out which scrolls passed (inferScrolls), ask only for prices, and show the estimate.
// Under the hood it fills the same calculator, so the estimate and card are the same as in "Build an item".

let mode = "b";
const fin = { item: null, options: [], choice: 0, clean: null };

function setMode(m) {
  mode = m;
  document.documentElement.classList.toggle("mode-f", m === "f");
  $("tabBuild").setAttribute("aria-selected", String(m === "b"));
  $("tabFinished").setAttribute("aria-selected", String(m === "f"));
  $("finishedCard").hidden = m !== "f";
  $("resultCard").querySelector("h2 b").textContent = m === "f" ? "2" : "4";
  if (m === "f") { if (!fin.item) $("resultCard").hidden = true; else applyFin(); }
  else if (state.item) { for (const id of ["cleanField", "rollCard", "scrollCard", "resultCard"]) $(id).hidden = false; renderCleanPrice(); update(); }
}
for (const el of document.querySelectorAll("[data-mode]")) {
  el.addEventListener("click", () => { setMode(el.dataset.mode); (el.dataset.mode === "f" ? $("finName") : search).focus(); });
}

const byName = (name) => { const n = (name || "").trim().toLowerCase(); return equips.find((e) => e[1].toLowerCase() === n) || null; };

// Stat lines: the item's own stats plus the ones its scrolls can add, in the game's order.
function finStatKeys(e) {
  const prefix = Math.floor(e[0] / 10000);
  const fromScrolls = new Set(scrolls.filter((s) => s.target === prefix).flatMap((s) => Object.keys(s.stats)));
  return GAME_ORDER.filter((k) => e[5][k] || fromScrolls.has(k));
}

function renderFinItem() {
  const e = fin.item;
  if (!e) { $("finHead").innerHTML = ""; $("finStats").innerHTML = ""; return; }
  const req = (e[6] && e[6].req) || [0, 0, 0, 0];
  $("finHead").innerHTML = `<span class="tt-icon"><img src="${icon(e[0])}" alt="" /></span>
    <span class="tt-req">REQ LEV : ${e[2]}${["STR", "DEX", "INT", "LUK"].map((k, i) => (req[i] ? `<br>REQ ${k} : ${req[i]}` : "")).join("")}
    <br><span class="tt-type">Type: ${esc(e[3])} · ${e[4]} slots</span></span>`;
  $("finStats").innerHTML = finStatKeys(e).map((k) => `<div class="tt-line" data-k="${k}">
    <span class="tt-dot">•</span> ${GAME_LABEL[k]}:
    +<input data-f="total" type="number" min="0" inputmode="numeric" placeholder="${e[5][k] || ""}" aria-label="${GAME_LABEL[k]} total" />
    <span class="tt-paren">( <span class="tt-clean">${e[5][k] || 0}</span> <input data-f="gain" type="text" inputmode="text" placeholder="+0" aria-label="${GAME_LABEL[k]}: the + or − number in brackets" /> )</span>
  </div>`).join("");
}

// "Did you mean…" when the picture's item name couldn't be read.
function renderSuggestions(list) {
  const box = $("finSuggest");
  box.innerHTML = list && list.length ? `<span class="label">Did you mean:</span> ${list.map((e) =>
    `<button type="button" class="suggest" data-name="${esc(e[1])}"><img src="${icon(e[0])}" alt="" /> ${esc(e[1])}</button>`).join("")}` : "";
}
$("finSuggest").addEventListener("click", (e) => {
  const b = e.target.closest(".suggest");
  if (!b) return;
  $("finName").value = b.dataset.name;
  renderSuggestions([]);
  onFinInput({ target: $("finName") });
});

// Put read values into the tooltip lines (those that exist for the current item).
function fillFinStats(stats) {
  for (const [k, v] of Object.entries(stats || {})) {
    const line = $("finStats").querySelector(`.tt-line[data-k="${k}"]`);
    if (!line) continue;
    line.querySelector('[data-f="total"]').value = v.total;
    line.querySelector('[data-f="gain"]').value = v.gain ? (v.gain > 0 ? "+" : "−") + Math.abs(v.gain) : "";
  }
}

// Each line: "+total (default ±difference)". The difference is the clean roll plus what scrolls added.
function readFin() {
  const num = (el) => (el && el.value !== "" ? Math.max(0, Math.floor(+el.value)) : null);
  const signed = (el) => { const m = String(el?.value || "").replace(/[−–]/g, "-").match(/^\s*([+-]?)\s*(\d+)/); return m ? (m[1] === "-" ? -1 : 1) * +m[2] : null; };
  const e = fin.item;
  const stats = {};
  for (const line of $("finStats").querySelectorAll(".tt-line[data-k]")) {
    const k = line.dataset.k, def = e[5][k] || 0;
    const total = num(line.querySelector('[data-f="total"]')), diff = signed(line.querySelector('[data-f="gain"]'));
    if (total == null && diff == null) continue;
    const t = total ?? def + (diff || 0);
    stats[k] = { total: t, base: def, gain: diff ?? t - def };
  }
  return { upgrades: num($("finUp")), left: num($("finLeft")), stats };
}

// How far a clean roll can land from the default, for matching the difference to scrolls.
// The usual roll range plus one point, which only counts as a rare outlier (see inferScrolls).
const rollTolerance = (k, def) => (def ? statRange(k, def)[1] - def + 1 : 0);

function onFinInput(e) {
  if (e && e.target.id === "finName") {
    const it = byName($("finName").value);
    if (it === fin.item) return;
    fin.item = it;
    renderFinItem();
    if (it) renderSuggestions([]);
    if (it && fin.pending) { fillFinStats(fin.pending); fin.pending = null; } // stats read from a picture before the item was known
  }
  if (!fin.item) {
    $("finScrolls").innerHTML = `<p class="hint">Type the item's name as it shows in the game, then its stats.</p>`;
    $("finPrices").innerHTML = ""; $("resultCard").hidden = true;
    return;
  }
  const r = readFin(), it = fin.item;
  const used = r.left != null ? it[4] - r.left : null;
  const gains = Object.fromEntries(Object.entries(r.stats).map(([k, v]) => [k, v.gain]));
  const tol = Object.fromEntries(Object.keys(gains).map((k) => [k, rollTolerance(k, it[5][k] || 0)]));
  const prefix = Math.floor(it[0] / 10000);
  const passes = r.upgrades ?? null;
  fin.options = inferScrolls({ gains, tol, passes, used, scrolls: scrolls.filter((s) => s.target === prefix) });
  fin.choice = 0;
  fin.read = r;
  renderFinScrolls();
  renderFinPrices();
  applyFin();
}

function renderFinScrolls() {
  const box = $("finScrolls");
  const r = fin.read;
  if (r.left != null && r.left > fin.item[4]) { box.innerHTML = `<p class="warn">This item has only ${fin.item[4]} slots.</p>`; return; }
  if (!fin.options.length) {
    box.innerHTML = `<p class="warn">No scrolls for this item add up to these numbers. Check the (+N) and the numbers after + in brackets.</p>`;
    return;
  }
  const text = (o) => (o.rows.length ? o.rows.map((x) => `${x.n}× ${esc(x.scroll.name)}`).join(" + ") : "No scroll passed");
  const used = r.left != null ? fin.item[4] - r.left : null, passed = fin.options[0].rows.reduce((a, x) => a + x.n, 0);
  box.innerHTML = `<p class="label">Scrolls that passed${used != null && used > passed ? ` · ${used - passed} failed` : ""}</p>
    ${fin.options.length === 1 ? `<p class="fin-one">${text(fin.options[0])}</p>`
    : `<fieldset class="reader-opts"><legend class="sr-only">Pick the scrolls</legend>${fin.options.map((o, i) => `<label>
      <input type="radio" name="finOpt" value="${i}" ${i === fin.choice ? "checked" : ""} /> ${text(o)}
      <small>${i === 0 ? "most likely · " : ""}${Math.round(o.share * 100)}%</small></label>`).join("")}</fieldset>`}`;
}

function finScrollList() {
  const o = fin.options[fin.choice];
  return o ? o.rows.map((x) => scrollById.get(x.scroll.id)) : [];
}

// ---------- "Is it worth it?": the shop's asking price against the estimate ----------
let lastPrice = null;
const finAsk = { value: null };

// Below 90% of the low end: good deal. Inside the range (±10%): fair. Above 110% of the high end: overpriced.
function verdictFor(ask, est) {
  if (!ask || !est) return null;
  if (ask < est.lo * 0.9) return { cls: "good", icon: "✅", text: "Good deal", note: `${Math.round((1 - ask / est.lo) * 100)}% below the estimate` };
  if (ask > est.hi * 1.1) return { cls: "bad", icon: "❌", text: "Overpriced", note: `${Math.round((ask / est.hi - 1) * 100)}% above the estimate` };
  return { cls: "fair", icon: "👍", text: "Fair price", note: "within the estimate" };
}

function renderVerdict() {
  const box = $("finVerdict");
  if (!box) return;
  const v = mode === "f" ? verdictFor(finAsk.value, lastPrice) : null;
  box.className = "verdict" + (v ? " " + v.cls : "");
  box.innerHTML = v ? `<b>${v.icon} ${v.text}</b> <span>Asking ${mesos(finAsk.value)}: ${v.note} (${rangeText(lastPrice.lo, lastPrice.hi)}).</span>`
    : finAsk.value && !lastPrice ? `<span>Enter the prices above to compare.</span>` : "";
}

function renderFinPrices() {
  const box = $("finPrices");
  if (!fin.options.length) { box.innerHTML = ""; return; }
  const it = fin.item;
  box.innerHTML = `<p class="label">Today's prices (from – to)</p>
    <div class="scroll-row price-row" data-clean="1">
      <img src="${icon(it[0])}" alt="" />
      <span class="nm"><b>Clean ${esc(it[1])}</b><small>with the clean stats above</small></span><span></span>
      <span class="row-price price-input">${rangeFields(fin.clean, "k")}
        <a href="${priceLink(it[0], it[1])}" data-name="${esc(it[1])}" target="_blank" rel="noopener">check price ↗</a></span>
    </div>
    ${finScrollList().map((sc) => `<div class="scroll-row price-row" data-id="${sc.id}">
      <img src="${scrollIcon(sc.id)}" alt="" />
      <span class="nm"><b>${esc(sc.name)}</b><small>${esc(scrollOdds(sc))} · ${esc(plusList(sc.stats))}</small></span><span></span>
      <span class="row-price price-input">${rangeFields(getPrice(sc.id), "m")}
        <a href="${priceLink(sc.id, sc.name)}" data-name="${esc(sc.name)}" target="_blank" rel="noopener">check price ↗</a></span>
    </div>`).join("")}
    <label class="ask-field">Shop asking price <small>(optional: is it worth it?)</small>
      <span class="price-input"><input id="finAsk" inputmode="decimal" placeholder="e.g. 5" aria-label="Shop asking price" value="${finAsk.raw || ""}" />
        ${unitSelect(finAsk.unit || "m", 'id="finAskUnit"')}</span></label>
    <div id="finVerdict" class="verdict" role="status"></div>`;
  renderVerdict();
}
function onAsk() {
  finAsk.raw = $("finAsk").value; finAsk.unit = $("finAskUnit").value;
  const v = readRange(finAsk.raw, "", finAsk.unit);
  finAsk.value = v ? v.lo : null;
  renderVerdict();
}

// Fill the calculator from the tooltip and show the estimate.
async function applyFin() {
  const it = fin.item, o = fin.options[fin.choice], r = fin.read;
  if (!it || !o || !r) { $("resultCard").hidden = true; return; }
  // clean roll = what the game shows − what these scrolls added
  const clean = { ...it[5] };
  for (const [k, v] of Object.entries(r.stats)) clean[k] = Math.max(0, v.total - ((o.got && o.got[k]) || 0));
  const rows = o.rows.map((x) => ({ scroll: scrollById.get(x.scroll.id), successes: x.n }));
  const passed = rows.reduce((a, x) => a + x.successes, 0);
  await pickItem(it[0], { clean, rows, left: r.left ?? Math.max(0, it[4] - passed) });
  cleanPrice = fin.clean;
  update();
}

$("finBox").addEventListener("input", (e) => onFinInput(e));
$("finName").addEventListener("change", (e) => onFinInput(e));
$("finScrolls").addEventListener("change", (e) => {
  if (e.target.name !== "finOpt") return;
  fin.choice = +e.target.value;
  renderFinPrices();
  applyFin();
});
function onFinPrice(e) {
  if (e.target.id === "finAsk" || e.target.id === "finAskUnit") { onAsk(); return; }
  if (!["from", "to", "unit"].includes(e.target.dataset.f)) return;
  const row = e.target.closest(".price-row");
  if (row.dataset.clean) { fin.clean = readFields(row); cleanPrice = fin.clean; }
  else setPrice(+row.dataset.id, readFields(row));
  update();
}
$("finPrices").addEventListener("input", onFinPrice);
$("finPrices").addEventListener("change", onFinPrice);

// Screenshot: read it in the browser, then fill the tooltip box.
$("finRead").addEventListener("click", () => $("finFile").click());
$("finFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const st = $("finStatus"), prog = $("finProg");
  prog.hidden = false; prog.value = 0; st.textContent = "Reading your item…";
  try {
    const { parsed: p } = await readImage(file, (text) => parseTooltip(text, equips), (v, label) => { prog.value = v; st.textContent = label; });
    if (p.item) { $("finName").value = p.item[1]; fin.item = p.item; renderFinItem(); }
    $("finUp").value = p.upgrades ?? "";
    $("finLeft").value = p.left ?? "";
    fin.pending = p.item ? null : p.stats; // filled in once the item is picked
    fillFinStats(p.stats);
    const n = Object.keys(p.stats).length;
    const got = [p.upgrades != null ? "(+N)" : null, p.left != null ? "slots left" : null, n ? `${n} stat${n > 1 ? "s" : ""}` : null].filter(Boolean);
    renderSuggestions(p.item ? [] : p.suggestions);
    st.textContent = !p.item && n ? `Read ${got.join(", ")}, but not the item's name. Pick it${p.suggestions.length ? " below" : " above"} and we'll fill in the rest.`
      : p.item && p.confidence < 0.8 ? `We think it's ${p.item[1]} (from its stats). Check it and fix anything that's off.`
      : got.length || p.item ? `Read ${[p.item ? "the item" : null, ...got].filter(Boolean).join(", ")}. Check the numbers and fix anything that's off.`
      : "Couldn't read this picture. A straight screenshot of the item's window works best; you can also type it in.";
    onFinInput();
    if (!p.item) $("finName").focus();
  } catch (err) {
    console.error("FMCheck reader:", err);
    st.textContent = "Couldn't read the picture here. You can type the numbers in instead.";
  } finally { prog.hidden = true; }
});

// ---------- accessibility options (saved in this browser) ----------

const A11Y_KEY = "fmcheck-a11y";
let a11y = {};
try { a11y = JSON.parse(localStorage.getItem(A11Y_KEY) || "{}") || {}; } catch { a11y = {}; }
function applyA11y() {
  for (const k of ["big", "still", "contrast", "links"]) document.documentElement.classList.toggle(`a11y-${k}`, !!a11y[k]);
  for (const box of document.querySelectorAll("[data-a11y]")) box.checked = !!a11y[box.dataset.a11y];
}
applyA11y();
$("a11yBtn").addEventListener("click", () => {
  const open = $("a11yPanel").hidden;
  $("a11yPanel").hidden = !open;
  $("a11yBtn").setAttribute("aria-expanded", String(open));
  if (open) $("a11yPanel").querySelector("input").focus();
});
$("a11yPanel").addEventListener("change", (e) => {
  const k = e.target.dataset.a11y;
  if (!k) return;
  a11y[k] = e.target.checked;
  try { localStorage.setItem(A11Y_KEY, JSON.stringify(a11y)); } catch { /* not saved, still applied */ }
  applyA11y();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("a11yPanel").hidden) { $("a11yPanel").hidden = true; $("a11yBtn").setAttribute("aria-expanded", "false"); $("a11yBtn").focus(); }
});

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
  // A shared calculation opens in "Build an item", where all of it is shown; "#m=f" alone opens the finished-item tab.
  const hq = new URLSearchParams(location.hash.slice(1));
  if (hq.get("m") === "f" && !hq.get("i")) setMode("f");
  const h = readHash();
  if (h) pickItem(h.id, h.restore);
  else if (search.value.trim()) showResults(); // typed before the list loaded
})();
