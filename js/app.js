import { ITEM_API, priceLink } from "./config.js";
import { STATS, STAT_LABEL, statRange, finalStats, estimate, mesos, parseMesos } from "./calc.js";
import { initPrices, getPrice, setPrice } from "./prices.js";

const $ = (id) => document.getElementById(id);
const icon = (id) => `${ITEM_API}/item/${id}/icon`;
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
  rows: [],          // { scroll, used, successes }
};

// ---------- data ----------

const metaCache = new Map();
async function loadMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const r = await fetch(`${ITEM_API}/item/${id}`);
  if (!r.ok) throw new Error(`item ${id}: ${r.status}`);
  const m = (await r.json()).metaInfo || {};
  const base = {};
  for (const [k] of STATS) if (m[`inc${k}`]) base[k] = m[`inc${k}`];
  const meta = { base, slots: m.tuc || 0 };
  metaCache.set(id, meta);
  return meta;
}

// ---------- item search ----------

const search = $("itemSearch"), results = $("itemResults");
let matches = [], active = 0;

function findItems(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts = [], has = [];
  for (const e of equips) {
    const n = e[1].toLowerCase();
    if (n.startsWith(q)) starts.push(e);
    else if (n.includes(q)) has.push(e);
    if (starts.length >= 30) break;
  }
  return starts.concat(has).slice(0, 30);
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
    $("itemInfo").querySelector(".sub").textContent = "Couldn't load this item's stats from maplestory.io. Try again in a moment.";
    return;
  }
  if (state.item?.id !== id) return; // picked something else meanwhile

  state.base = meta.base;
  state.slots = meta.slots;
  state.clean = { ...meta.base, ...(restore?.clean || {}) };
  state.keyStat = restore?.keyStat ?? defaultKeyStat(id, meta.base);
  state.rows = restore?.rows || [];

  const baseText = plusList(meta.base) || "no stats";
  $("itemInfo").innerHTML = `<img src="${icon(id)}" alt="" />
    <div><div class="name">${esc(e[1])}</div>
    <div class="sub">Lv ${e[2]} · ${esc(e[3])} · ${meta.slots} slots · ${esc(baseText)}</div></div>`;

  renderRolls();
  renderScrollPicker();
  renderRows();
  renderCleanPrice();
  for (const id of ["rollCard", "scrollCard", "resultCard"]) $(id).hidden = false;
  update();
}

function defaultKeyStat(id, base) {
  const isWeapon = Math.floor(id / 10000) >= 130;
  if (isWeapon) return (base.MAD || 0) > (base.PAD || 0) ? "MAD" : (base.PAD ? "PAD" : "");
  return ["PAD", "MAD", "STR", "DEX", "INT", "LUK", "ACC", "EVA", "Speed", "Jump"].find((k) => base[k]) || "";
}

// ---------- clean roll sliders ----------

function renderRolls() {
  const keys = STATS.map(([k]) => k).filter((k) => state.base[k]);
  const box = $("rolls");
  if (!keys.length) {
    box.innerHTML = `<p class="hint">This item has no stats that roll.</p>`;
  } else {
    box.innerHTML = keys.map((k) => {
      const [lo, hi] = statRange(k, state.base[k]);
      return `<div class="roll">
        <span class="lbl">${STAT_LABEL[k]}</span>
        <input type="range" min="${lo}" max="${hi}" value="${state.clean[k]}" data-k="${k}" aria-label="${STAT_LABEL[k]}" />
        <span class="val"><span>${state.clean[k]}</span><small>${lo}–${hi}</small></span></div>`;
    }).join("");
  }
  box.oninput = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    state.clean[k] = +e.target.value;
    e.target.parentElement.querySelector(".val span").textContent = e.target.value;
    update();
  };

  const sel = $("keyStat");
  sel.innerHTML = `<option value="">nothing (any roll)</option>` +
    keys.map((k) => `<option value="${k}">${STAT_LABEL[k]}</option>`).join("");
  sel.value = state.keyStat;
  sel.onchange = () => { state.keyStat = sel.value; update(); };
}

// ---------- scrolls ----------

const shortName = (s) => s.name.replace(/^(dark )?scroll for .*? for /i, (_, dark) => (dark ? "Dark " : ""));

function renderScrollPicker() {
  const prefix = Math.floor(state.item.id / 10000);
  const list = scrolls.filter((s) => s.target === prefix)
    .sort((a, b) => shortName(a).localeCompare(shortName(b), undefined, { numeric: true }));
  const sel = $("scrollPick");
  sel.innerHTML = list.length
    ? list.map((s) => `<option value="${s.id}">${esc(shortName(s))} — ${esc(plusList(s.stats))}${s.boom ? " · may boom" : ""}</option>`).join("")
    : `<option value="">No scrolls for this item type</option>`;
  $("addScroll").disabled = !list.length;
}

$("addScroll").addEventListener("click", () => {
  const s = scrollById.get(+$("scrollPick").value);
  if (!s) return;
  const left = Math.max(1, state.slots - usedSlots());
  state.rows.push({ scroll: s, used: left, successes: left });
  renderRows();
  update();
});

const usedSlots = () => state.rows.reduce((n, r) => n + r.used, 0);

function renderRows() {
  const box = $("scrollRows");
  if (!state.rows.length) {
    box.innerHTML = `<p class="hint">No scrolls yet. A clean item works too.</p>`;
    return;
  }
  box.innerHTML = state.rows.map((r, i) => {
    const p = getPrice(r.scroll.id);
    return `<div class="scroll-row" data-i="${i}">
      <div class="head"><strong>${esc(shortName(r.scroll))}</strong>
        <span class="gain">${esc(plusList(r.scroll.stats))}${r.scroll.boom ? " · boom " + r.scroll.boom + "% on fail" : ""}</span>
        <button class="ghost" data-act="del" type="button" aria-label="Remove">✕</button></div>
      <div class="nums">
        <label>Used<input type="number" min="0" max="${state.slots}" value="${r.used}" data-f="used" /></label>
        <label>Passed<input type="number" min="0" max="${r.used}" value="${r.successes}" data-f="successes" /></label>
        <label>Price each ${p?.from === "feed" ? '<span class="tag">live</span>' : ""}
          <span class="price-input"><input inputmode="decimal" placeholder="e.g. 2m" value="${p ? mesos(p.value) : ""}" data-f="price" />
          <a href="${priceLink(r.scroll.id)}" target="_blank" rel="noopener">check ↗</a></span></label>
      </div></div>`;
  }).join("");
}

$("scrollRows").addEventListener("input", (e) => {
  const row = e.target.closest(".scroll-row");
  const f = e.target.dataset.f;
  if (!row || !f) return;
  const r = state.rows[+row.dataset.i];
  if (f === "price") {
    setPrice(r.scroll.id, parseMesos(e.target.value));
  } else {
    const v = Math.max(0, Math.floor(+e.target.value || 0));
    r[f] = v;
    if (f === "used") {
      const passed = row.querySelector('[data-f="successes"]');
      passed.max = v;
      if (r.successes > v) { r.successes = v; passed.value = v; }
    } else if (r.successes > r.used) { r.successes = r.used; e.target.value = r.used; }
  }
  update();
});
$("scrollRows").addEventListener("click", (e) => {
  if (e.target.dataset.act !== "del") return;
  state.rows.splice(+e.target.closest(".scroll-row").dataset.i, 1);
  renderRows();
  update();
});

// ---------- clean price ----------

function renderCleanPrice() {
  const p = getPrice(state.item.id);
  $("cleanPrice").value = p ? mesos(p.value) : "";
  $("cleanLink").href = priceLink(state.item.id);
}
$("cleanPrice").addEventListener("input", (e) => {
  setPrice(state.item.id, parseMesos(e.target.value));
  update();
});

// ---------- result ----------

function update() {
  if (!state.item) return;
  const used = usedSlots();
  const over = used > state.slots;
  $("slotInfo").innerHTML = over
    ? `<span class="warn">${used} of ${state.slots} slots used: too many</span>`
    : `${used} of ${state.slots} slots used · ${state.slots - used} left`;

  const groups = state.rows.map((r) => ({
    used: r.used, successes: r.successes, success: r.scroll.success, boom: r.scroll.boom,
    price: getPrice(r.scroll.id)?.value || 0, stats: r.scroll.stats,
  }));

  // final stats
  const fin = finalStats(state.clean, groups);
  $("final").innerHTML = STATS.filter(([k]) => fin[k]).map(([k, lbl]) => {
    const gain = fin[k] - (state.base[k] || 0);
    return `<span class="chip">${lbl} ${fin[k]}${gain ? ` <b>(${gain > 0 ? "+" : ""}${gain})</b>` : ""}</span>`;
  }).join("") || `<span class="hint">No stats.</span>`;

  const clean = getPrice(state.item.id)?.value;
  const missing = state.rows.filter((r) => !getPrice(r.scroll.id)).length;
  const k = state.keyStat;
  const res = estimate({
    cleanPrice: clean || 0,
    roll: k ? { key: k, base: state.base[k], value: state.clean[k] } : null,
    groups,
  });

  const out = $("estimate");
  if (over) { out.innerHTML = `<p class="warn">More scrolls than the item has slots. Check the "Used" numbers.</p>`; return; }
  if (!clean && !groups.some((g) => g.price)) {
    out.innerHTML = `<p class="hint">Add the clean item price and scroll prices to get an estimate. Tap "check ↗" to see today's prices on meso.watch.</p>`;
    return;
  }
  const pct = (x) => (x >= 0.995 ? "100%" : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toPrecision(2)}%`);
  out.innerHTML = `
    <div class="big">≈ ${mesos(res.value)}</div>
    <div class="range">likely sells for ${mesos(res.low)} – ${mesos(res.high)}</div>
    <div class="breakdown">
      <span>One try (clean + scrolls)</span><span>${mesos(res.tryCost)}</span>
      ${k ? `<span>Clean ${STAT_LABEL[k]} roll this good or better</span><span>${pct(res.rollChance)}</span>` : ""}
      <span>Scrolls pass like this</span><span>${pct(res.scrollChance)}</span>
      <span>Odds of making it</span><span>1 in ${res.oneIn < 1e6 ? Math.round(res.oneIn).toLocaleString("en-US") : mesos(res.oneIn)}</span>
    </div>
    ${missing ? `<p class="warn">${missing} scroll${missing > 1 ? "s have" : " has"} no price, counted as 0.</p>` : ""}
    ${!clean ? `<p class="warn">No clean item price, counted as 0.</p>` : ""}`;
  saveHash();
}

// ---------- shareable address: #i=<id>&r=PAD.50,STR.3&k=PAD&s=2043001.7.5,... ----------

function saveHash() {
  const r = Object.entries(state.clean).filter(([k, v]) => v !== state.base[k]).map(([k, v]) => `${k}.${v}`).join(",");
  const s = state.rows.map((x) => `${x.scroll.id}.${x.used}.${x.successes}`).join(",");
  const q = new URLSearchParams({ i: state.item.id });
  if (r) q.set("r", r);
  if (state.keyStat !== defaultKeyStat(state.item.id, state.base)) q.set("k", state.keyStat);
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
    const [sid, used, ok] = part.split(".").map(Number);
    const scroll = scrollById.get(sid);
    return scroll && { scroll, used: used || 0, successes: Math.min(ok || 0, used || 0) };
  }).filter(Boolean);
  return { id, restore: { clean, rows, keyStat: q.has("k") ? q.get("k") : undefined } };
}

// ---------- start ----------

(async function start() {
  const [eq, sc, info] = await Promise.all([
    fetch("data/equips.json").then((r) => r.json()),
    fetch("data/scrolls.json").then((r) => r.json()),
    initPrices(),
  ]);
  equips = eq;
  scrolls = sc;
  scrollById = new Map(sc.map((s) => [s.id, s]));
  $("priceStatus").textContent = info.source === "feed"
    ? `Live prices${info.updated ? ` from ${new Date(info.updated).toLocaleString()}` : ""}. Any price you type wins and is saved in this browser.`
    : "Prices you type are saved in this browser. Live prices aren't connected yet.";
  const h = readHash();
  if (h) pickItem(h.id, h.restore);
  else search.focus();
})();
