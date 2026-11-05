import { iconUrl, priceLink, DONATE_URL } from "./config.js?v=f012693d";
import { STATS, STAT_LABEL, statRange, rollAtLeast, groupOdds, allocateFailures, finalStats, openSlotValue, cheapestRoute, mesos, UNITS, readRange } from "./calc.js?v=f012693d";
import { getPrice, setPrice } from "./prices.js?v=f012693d";

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

// ---------- item search ----------

const search = $("itemSearch"), results = $("itemResults");
let matches = [], active = 0;

// Best matches first: name starts with it, then a word in the name starts with it, then anywhere.
function findItems(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const starts = [], word = [], has = [];
  for (const e of equips) {
    const n = e[1].toLowerCase();
    if (n.startsWith(q)) starts.push(e);
    else if (n.includes(" " + q) || n.includes("-" + q)) word.push(e);
    else if (q.length > 1 && n.includes(q)) has.push(e);
  }
  return starts.concat(word, has).slice(0, 30);
}

function showResults() {
  matches = findItems(search.value);
  active = 0;
  results.hidden = !matches.length;
  results.innerHTML = matches.map((e, i) =>
    `<li role="option" data-i="${i}" aria-selected="${i === 0}">
      <img loading="lazy" src="${icon(e[0])}" alt="" /><span>${esc(e[1])}</span>
      <span class="meta">Lv ${e[2]} · ${esc(e[3])}</span></li>`).join("");
}

function moveActive(d) {
  if (!matches.length) return;
  active = (active + d + matches.length) % matches.length;
  [...results.children].forEach((li, i) => li.setAttribute("aria-selected", i === active));
  results.children[active].scrollIntoView({ block: "nearest" });
}

search.addEventListener("input", showResults);
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
  else if (e.key === "Enter" && matches[active]) { e.preventDefault(); pickItem(matches[active][0]); }
  else if (e.key === "Escape") results.hidden = true;
});
results.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li");
  if (li) { e.preventDefault(); pickItem(matches[+li.dataset.i][0]); }
});
search.addEventListener("blur", () => setTimeout(() => (results.hidden = true), 100));

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
  return ["PAD", "MAD", "STR", "DEX", "INT", "LUK", "ACC", "EVA", "Speed", "Jump"].find((k) => base[k]) || "";
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
      ${k === state.keyStat ? `<span class="note" id="rollNote">${rollNote(k)}</span>` : ""}</div>`;
  }).join("");
  box.oninput = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    state.clean[k] = +e.target.value;
    e.target.parentElement.querySelector(".val span").textContent = e.target.value;
    if (k === state.keyStat) $("rollNote").textContent = rollNote(k);
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
    return `<li data-id="${s.id}" role="button" tabindex="0">
      <img src="${scrollIcon(s.id)}" alt="" />
      <span class="nm"><b>${esc(shortName(s))}</b><small>${esc(scrollOdds(s))} · ${esc(plusList(s.stats))}</small></span>
      <span class="pr">${p ? rangeText(p.lo, p.hi) : ""}</span></li>`;
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
  const li = e.target.closest("li[data-id]");
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
        <span class="count">×${r.successes}</span>
        <button type="button" class="step" data-act="plus" aria-label="One more">+</button>
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
  } else {
    r.successes--;
    state.left = Math.min(state.slots, state.left + 1);
    if (r.successes <= 0) state.rows.splice(i, 1);
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
  if (failed < 0) { box.innerHTML = ""; return; }
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
  $("final").innerHTML = STATS.filter(([k]) => fin[k]).map(([k, lbl]) => {
    const gain = fin[k] - (state.clean[k] || 0); // what the scrolls added
    return `<span class="chip">${lbl} ${fin[k]}${gain ? ` <b>(${gain > 0 ? "+" : ""}${gain})</b>` : ""}</span>`;
  }).join("") || `<span class="hint">No stats.</span>`;

  renderOdds(failed);
  saveHash();
  const out = $("estimate");
  if (failed < 0) { out.innerHTML = `<p class="warn">You listed more passed scrolls than used slots. Check "Slots left".</p>`; return; }
  if (!cleanPrice) { out.innerHTML = `<p class="hint">Enter the clean item price (step 1) to get an estimate.</p>`; return; }

  // What the item gained, per scroll family, and the scrolls the user entered (with a price).
  const needs = {};
  for (const r of state.rows) needs[family(r.scroll)] = (needs[family(r.scroll)] || 0) + r.successes * points(r.scroll);
  const tiersAt = (end) => state.rows.map((r) => r.scroll).map((sc) => ({
    id: sc.id, fam: family(sc), points: points(sc), success: sc.success, boom: sc.boom, price: getPrice(sc.id)?.[end],
  })).filter((t) => Number.isFinite(t.price));
  const pointsGained = Object.values(needs).reduce((a, b) => a + b, 0);

  // Worked out twice: with every "from" price, then with every "to" price.
  const run = (end) => {
    const clean = cleanPrice[end], tiers = tiersAt(end);
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
    return;
  }

  const byId = new Map(scrolls.map((sc) => [sc.id, sc]));
  const plan = Object.entries(lo.uses).sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${n.toFixed(1)}× ${esc(shortName(byId.get(+id)).split(":").pop().trim())}`).join(", ");
  const pct = (x) => (x >= 0.995 ? "100%" : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toPrecision(2)}%`);
  const items = (n) => (n < 1e6 ? (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US")) : mesos(n));
  out.innerHTML = `
    <div class="big">${lo.value === hi.value ? "≈ " : ""}${rangeText(lo.value, hi.value)}</div>
    <div class="range">${lo.value === hi.value ? "from the prices you entered" : `midpoint ≈ ${mesos((lo.value + hi.value) / 2)}`}</div>
    <div class="breakdown">
      <span>Cheapest way to make one</span><span>${rangeText(lo.cost, hi.cost)}</span>
      ${state.left > 0 ? `<span>${state.left} open slot${state.left > 1 ? "s" : ""} (room to scroll more)</span><span>${hi.open > 0 ? "+" + rangeText(lo.open, hi.open) : "+0 (more scrolls cost about what they add)"}</span>` : ""}
      ${pointsGained ? `<span>Clean items the cheapest way uses</span><span>${items(lo.cleanItems)}</span>
      <span>Scrolls per clean item</span><span>${plan || "–"}</span>` : ""}
    </div>
    ${unpriced.length ? `<p class="warn">No price for ${unpriced.join(", ")}: left out of the cheapest way.</p>` : ""}`;
}

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

// ---------- start ----------

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
  const h = readHash();
  if (h) pickItem(h.id, h.restore);
  else if (search.value.trim()) showResults(); // typed before the list loaded
  else search.focus();
})();
