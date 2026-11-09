import { iconUrl, DONATE_URL, DISCORD_URL } from "./config.js?v=c25d3b4c";
import { STATS, STAT_LABEL, statRange, rollAtLeast, finalStats, mesos, readPrice } from "./calc.js?v=c25d3b4c";
import { rarity, oneInText } from "./rarity.js?v=c25d3b4c";
import { drawCard, cardBlob } from "./card.js?v=c25d3b4c";
import { cardInfo, cardLabel, cardFmt } from "./itemcard.js?v=c25d3b4c";
import { itemSearch } from "./itemsearch.js?v=c25d3b4c";
import { setupA11y } from "./a11y.js?v=c25d3b4c";
import { API, api, health, me, googleButton, validIgn } from "./account.js?v=c25d3b4c";

const $ = (id) => document.getElementById(id);
const icon = iconUrl;
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

// ---------- read the item from a picture (js/shot.js, js/itemread.js) ----------

let shotBusy = false, lastShot = null;
const scrollName = (id) => shortName(scrollById.get(id));
const rowsText = (rows) => rows.length ? rows.map((r) => `${r.n}× ${esc(scrollName(r.id))}`).join(", ") : "no scrolls passed";

async function readShot(file) {
  if (!file || !/^image\//.test(file.type) || shotBusy) return;
  const box = $("shotResult");
  box.hidden = false;
  box.innerHTML = `<p class="hint">Getting the reader ready…</p>`;
  shotBusy = true;
  try {
    const { readItemPicture } = await import(new URL(`./shot.js${new URL(import.meta.url).search}`, import.meta.url));
    const res = await readItemPicture(file, equips, scrolls, (t) => { box.innerHTML = `<p class="hint">${esc(t)}</p>`; });
    lastShot = res;
    const top = res.items[0];
    if (!top || top.s < 2.5 || !res.guess) {
      box.innerHTML = `<p class="warn">Couldn't read an item window in that picture. Try a screenshot where the item's window is clear,
        or find the item below.</p>${readDetails(res.text)}`;
      return;
    }
    applyShot(top.e, res.guess.best, res.guess.left);
  } catch (e) {
    box.innerHTML = `<p class="warn">Couldn't read the picture: ${esc(e.message || "try again")}.</p>`;
  } finally {
    shotBusy = false;
  }
}
const readDetails = (text) => `<details class="shot-read"><summary>What was read</summary><pre>${esc(text.trim())}</pre></details>`;

// Fill the steps with what was read, and offer the other likely items and scroll guesses.
function applyShot(equip, guess, left) {
  const res = lastShot;
  const restore = guess ? {
    clean: guess.clean,
    rows: guess.rows.map((r) => ({ scroll: scrollById.get(r.id), successes: r.n })).filter((r) => r.scroll),
    left,
  } : { left };
  pickItem(equip[0], restore);
  const g = guessScrolls_(equip);
  const otherItems = res.items.filter((x) => x.e[0] !== equip[0] && x.s > res.items[0].s - 2).slice(0, 3);
  const otherGuesses = (g ? [g.best, ...g.others] : []).filter((x) => x && JSON.stringify(x.rows) !== JSON.stringify(guess?.rows)).slice(0, 2);
  $("shotResult").innerHTML = `
    <p><b>Read from your picture:</b> ${esc(equip[1])}${guess && guess.passes ? ` (+${guess.passes})` : ""}, ${left} slot${left === 1 ? "" : "s"} left.
      ${guess ? `Likely scrolls: <b>${rowsText(guess.rows)}</b>.` : "Couldn't tell which scrolls passed: add them under Scrolls."}
      Check the steps below and fix anything that's off.</p>
    ${otherItems.length ? `<p class="shot-alt">Not this item? ${otherItems.map((x) => `<button type="button" class="ghost-btn mini" data-shot-item="${x.e[0]}">${esc(x.e[1])}</button>`).join(" ")}</p>` : ""}
    ${otherGuesses.length ? `<p class="shot-alt">Other scrolls that fit: ${otherGuesses.map((x, i) => `<button type="button" class="ghost-btn mini" data-shot-guess="${i}">${rowsText(x.rows)}</button>`).join(" ")}</p>` : ""}
    ${readDetails(res.text)}`;
  $("shotResult").onclick = (e) => {
    const it = e.target.closest("[data-shot-item]");
    if (it) {
      const eq = equips.find((x) => x[0] === +it.dataset.shotItem);
      const gg = guessScrolls_(eq);
      applyShot(eq, gg && gg.best, gg ? gg.left : eq[4]);
      return;
    }
    const gb = e.target.closest("[data-shot-guess]");
    if (gb) applyShot(equip, otherGuesses[+gb.dataset.shotGuess], left);
  };
}
let guessFn = null;
const guessScrolls_ = (equip) => (guessFn && lastShot ? guessFn(equip, lastShot.read, scrolls) : null);

$("shotFile").addEventListener("change", async (e) => {
  if (!guessFn) guessFn = (await import(new URL(`./itemread.js${new URL(import.meta.url).search}`, import.meta.url))).guessScrolls;
  readShot(e.target.files[0]);
  e.target.value = "";
});
const shotBox = $("shotBox");
shotBox.addEventListener("dragover", (e) => { e.preventDefault(); shotBox.classList.add("over"); });
shotBox.addEventListener("dragleave", () => shotBox.classList.remove("over"));
shotBox.addEventListener("drop", async (e) => {
  e.preventDefault();
  shotBox.classList.remove("over");
  if (!guessFn) guessFn = (await import(new URL(`./itemread.js${new URL(import.meta.url).search}`, import.meta.url))).guessScrolls;
  readShot(e.dataTransfer.files[0]);
});
document.addEventListener("paste", async (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type));
  if (!f) return;
  e.preventDefault();
  if (!guessFn) guessFn = (await import(new URL(`./itemread.js${new URL(import.meta.url).search}`, import.meta.url))).guessScrolls;
  shotBox.scrollIntoView({ behavior: "smooth", block: "center" });
  readShot(f);
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
  $("slotsLeft").max = state.slots;
  $("slotsLeft").value = state.left;
  for (const id of ["rollCard", "scrollCard", "resultCard"]) $(id).hidden = false;
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
    return `<li><button type="button" class="pick" data-id="${s.id}">
      <img src="${scrollIcon(s.id)}" alt="" />
      <span class="nm"><b>${esc(shortName(s))}</b><small>${esc(scrollOdds(s))} · ${esc(plusList(s.stats))}</small></span></button></li>`;
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
function renderRows() {
  const box = $("scrollRows");
  if (!state.rows.length) {
    box.innerHTML = `<p class="hint">None yet. A clean item works too.</p>`;
    return;
  }
  box.innerHTML = state.rows.map((r, i) => {
    return `<div class="scroll-row" data-i="${i}">
      <img src="${scrollIcon(r.scroll.id)}" alt="" />
      <span class="nm"><b>${esc(shortName(r.scroll))}</b><small>${esc(scrollOdds(r.scroll))} · ${esc(plusList(r.scroll.stats))}</small></span>
      <span class="stepper small">
        <button type="button" class="step" data-act="minus" aria-label="One less">−</button>
        <span class="count" ${r.successes ? "" : 'title="Used, but every one failed"'}>×${r.successes}</span>
        <button type="button" class="step" data-act="plus" aria-label="One more">+</button>
        <button type="button" class="step" data-act="remove" aria-label="Remove this scroll">✕</button>
      </span>
      </div>`;
  }).join("");
}

$("scrollRows").addEventListener("click", (e) => {
  const act = e.target.dataset.act;
  const row = e.target.closest(".scroll-row");
  if (!act || !row) return;
  const i = +row.dataset.i, r = state.rows[i];
  if (act === "plus") {
    r.successes++;
    state.left = Math.max(0, state.left - 1);
  } else if (act === "minus" && r.successes > 0) {
    // ×0 stays: "used, but it failed every time" (it counts for the scroll odds)
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

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}
// ---------- result ----------

// How rare it is (js/rarity.js): the natural roll and the way the scrolls passed.
function renderRarity(failed) {
  const box = $("odds");
  if (failed < 0) { box.innerHTML = ""; return null; }
  const r = rarity({
    base: state.base, clean: state.clean, used: state.slots - state.left,
    rows: state.rows.map((x) => ({ successes: x.successes, success: x.scroll.success, boom: x.scroll.boom })),
  });
  const part = (p) => (p >= 0.995 ? "any" : oneInText(1 / p));
  box.innerHTML = `
    <div class="rarity-main" style="--tier:${r.tier.color}">
      <span class="tier">${r.tier.name}</span><b>${oneInText(r.oneIn)}</b>
      <small>items like this</small>
    </div>
    <div class="breakdown">
      <span>Natural roll${r.rollParts.length ? `: ${r.rollParts.map((x) => `${STAT_LABEL[x.k]} ${x.value}`).join(", ")}` : " (default or lower)"}</span><span>${part(r.roll)}</span>
      <span>Scrolls passing like this${r.failed && state.rows.length ? ` (${r.failed} failed)` : ""}</span><span>${part(r.scrolls)}</span>
    </div>`;
  return r;
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

  const r = renderRarity(failed);
  saveHash();
  lastRarity = r;
  renderCard(fin, r);
}

let lastRarity = null; // for publishing
let supportersOn = false; // memberships open (Ko-fi set up): only then is anything about them shown

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
  const forSale = pubMode() === "sale";
  const priceText = $("pubPrice").value.trim();
  const price = forSale ? readPrice(priceText, pubUnit()) : null;
  if (forSale && !(price > 0)) { msg.textContent = "Enter your price, e.g. 48 for 48M."; $("pubPrice").focus(); return; }
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
      chance: lastRarity ? lastRarity.chance : 1,
      price, channel: forSale ? $("pubChannel").value.trim() : "", room: forSale ? $("pubRoom").value.trim() : "",
      where: forSale ? $("pubWhere").value.trim() : "", note: $("pubNote").value.trim(),
      image: $("card").toDataURL("image/png"),
    } });
    const link = `${location.origin}/community.html#l=${j.id}`;
    msg.innerHTML = `Posted! <a href="community.html#l=${j.id}">See it on FMCheck</a>
      · <button type="button" class="ghost-btn" id="pubCopy">Copy link</button>`;
    $("pubCopy").addEventListener("click", () => navigator.clipboard.writeText(link).then(() => toast("Link copied.")).catch(() => {}));
    // the screen check, if they chose it (it works on a computer only)
    if (canCheck && $("pubCheck").checked) {
      try {
        const listing = (await api(`/api/listings/${j.id}`)).listing;
        const { startVerify } = await import(new URL(`./verify.js${new URL(import.meta.url).search}`, import.meta.url));
        startVerify(listing, equips.find((x) => x[0] === listing.item), () => {
          msg.insertAdjacentHTML("beforeend", ` <span class="badge ok"><img class="ic" src="assets/ui/mirror.png" alt="" /> Checked on screen</span>`);
          toast("Checked on screen: your item now shows the badge.");
        });
      } catch { /* they can still do it under My items */ }
    }
  } catch (err) {
    msg.innerHTML = esc(err.message) + (err.upsell && supportersOn ? ` <a class="sup-link" href="community.html#supporters"><img class="ic" src="assets/ui/starpiece.png" alt="" /> Become a supporter</a>` : "");
    if (err.status === 401) { pubUser = null; showPublish(null); }
  } finally {
    $("pubSend").disabled = false;
  }
});

// The price part of the form: "just showing it off" or "for sale", a big price field with K / M / B,
// and the full amount spelled out as you type.
const pubMode = () => document.querySelector('input[name="pubMode"]:checked')?.value || "sale";
const pubUnit = () => document.querySelector('input[name="pubUnit"]:checked')?.value || "m";
function sayPrice() {
  const t = $("pubPrice").value.trim();
  const v = readPrice(t, pubUnit());
  // what the chosen button means, with an example in that unit
  const how = { k: ["thousands", "500", 500e3], m: ["millions", "48", 48e6], b: ["billions", "1.5", 1.5e9] }[pubUnit()];
  $("pubPriceSay").textContent = !t ? `In ${how[0]}: ${how[1]} = ${how[2].toLocaleString("en-US")} mesos.`
    : v > 0 ? `= ${Math.round(v).toLocaleString("en-US")} mesos` : "That doesn't look like a price. Type just the number, like 48 or 1.5.";
  $("pubPriceSay").classList.toggle("bad", !!t && !(v > 0));
}
$("pubForm").addEventListener("change", (e) => {
  if (e.target.name === "pubMode") {
    $("saleBox").hidden = pubMode() !== "sale";
    if (pubMode() === "sale") $("pubPrice").focus();
  }
  if (e.target.name === "pubUnit") sayPrice();
});
$("pubPrice").addEventListener("input", sayPrice);

// Screen checks need a computer browser that can share a window; on phones, say it can be done later.
const canCheck = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
if (!canCheck) { $("checkBox").hidden = true; $("checkLater").hidden = false; }

// ---------- result card (in-game tooltip style) ----------

function renderCard(fin, r) {
  const e = equips.find((x) => x[0] === state.item.id);
  const d = cardInfo({
    equip: e, fin, clean: state.clean, left: state.left, upgrades: passedTotal(),
    rarity: r || rarity({ base: state.base, clean: state.clean }),
    scrolls: state.rows.map((x) => ({ n: x.successes, name: shortName(x.scroll) })),
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
  ["assets/guide/1.webp?v=6", "1. Pick your item: upload a screenshot of it, or search it, or tap a category and a class to browse."],
  ["assets/guide/2.webp?v=6", "2. Set its clean stats: what it had before any scroll. A roll above the default makes it rarer."],
  ["assets/guide/3.webp?v=6", "3. Set the slots left and add the scrolls that passed. Failed ones are worked out for you."],
  ["assets/guide/4.webp?v=6", "4. See how rare it is, from its natural roll and the way its scrolls passed, and save the card to share it."],
  ["assets/guide/5.webp?v=6", "5. Post it: sign in with Google and post the item. Selling it? Add a price and where to find you (optional)."],
  ["assets/guide/6.webp?v=6", "6. Browse items: everyone's posts with their price, stats and rarity. Filter by kind, rarity, stat or your own price range."],
  ["assets/guide/7.webp?v=6", "7. Tap an item to see its full card and who posted it. Checked on screen: the owner showed the item from the game."],
  ["assets/guide/8.webp?v=6", "8. Under My items: check it on screen, edit it, mark it sold or remove it."],
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
  health().then((j) => {
    if (j.community) setupPublish();
    supportersOn = !!j.supporters;
    document.documentElement.classList.toggle("sup-on", supportersOn);
  });
  const h = readHash();
  if (h) pickItem(h.id, h.restore);
  else if (search.value.trim()) showResults(); // typed before the list loaded
})();
