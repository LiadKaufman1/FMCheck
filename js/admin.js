// The price list page (admins): average prices of scrolls and clean items that estimates use when a player
// leaves a price empty. Stored on the server (/api/prices); anyone can read them, only admins can change them.
import { mesos, readPrice, UNITS } from "./calc.js?v=7efc9b4c";
import { setupA11y } from "./a11y.js?v=7efc9b4c";
import { api, me, googleButton, esc, canSignIn } from "./account.js?v=7efc9b4c";
import { iconUrl, priceLink } from "./config.js?v=7efc9b4c";
import { findPrices } from "./priceimport.js?v=7efc9b4c";

const $ = (id) => document.getElementById(id);
setupA11y();

let equips = [], scrolls = [], byId = new Map();
let rows = [];          // [{ id, price }] shown in the table
let saved = {};         // what the server has
let removed = new Set();

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}

const kind = (id) => (id >= 2000000 ? "Scroll" : "Clean item");
const name = (id) => byId.get(id)?.name || String(id);
const unitFor = (p) => (UNITS.slice().reverse().find(([, , m]) => m > 1 && p >= m) || UNITS[0]);
const priceField = (p) => {
  const u = p ? unitFor(p) : UNITS[2];
  return `<input inputmode="decimal" data-f="price" aria-label="Average price" placeholder="average price" value="${p ? +(p / u[2]).toPrecision(4) : ""}" />
    <select data-f="unit" aria-label="Unit">${UNITS.map(([v, l]) => `<option value="${v}"${v === u[0] ? " selected" : ""}>${l}</option>`).join("")}</select>`;
};

function render() {
  const list = rows.slice().sort((a, b) => kind(a.id).localeCompare(kind(b.id)) || name(a.id).localeCompare(name(b.id)));
  $("priceRows").innerHTML = list.length ? list.map((r) => `<li class="price-row" data-id="${r.id}">
      <img src="${iconUrl(r.id)}" alt="" />
      <span class="nm"><b>${esc(name(r.id))}</b><small>${kind(r.id)}</small></span>
      <span class="pf">${priceField(r.price)}</span>
      <a href="${priceLink(r.id, name(r.id))}" target="_blank" rel="noopener">check ↗</a>
      <button type="button" class="ghost-btn mini" data-remove aria-label="Remove ${esc(name(r.id))}">✕</button>
    </li>`).join("") : `<li class="hint">No prices yet. Add the scrolls and clean items players use most.</li>`;
}

function readRows() {
  for (const li of document.querySelectorAll(".price-row")) {
    const r = rows.find((x) => x.id === +li.dataset.id);
    const v = readPrice(li.querySelector('[data-f="price"]').value, li.querySelector('[data-f="unit"]').value);
    r.price = Number.isFinite(v) && v > 0 ? v : null;
  }
}

function add(id) {
  if (rows.some((r) => r.id === id)) { toast("Already in the list."); return; }
  readRows();
  rows.push({ id, price: null });
  removed.delete(id);
  render();
  document.querySelector(`.price-row[data-id="${id}"] [data-f="price"]`)?.focus();
}

function search() {
  const q = $("addQ").value.trim().toLowerCase();
  const box = $("addResults");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const hits = [...scrolls.map((s) => [s.id, s.name]), ...equips.map((e) => [e[0], e[1]])]
    .filter(([, n]) => n.toLowerCase().includes(q)).slice(0, 12);
  box.innerHTML = hits.map(([id, n]) => `<li><button type="button" data-add="${id}"><img src="${iconUrl(id)}" alt="" />
    <span>${esc(n)}</span><small>${kind(id)}</small></button></li>`).join("") || `<li class="hint">Nothing matches.</li>`;
}

async function save() {
  readRows();
  const prices = {};
  for (const r of rows) if (r.price !== saved[r.id]) prices[r.id] = r.price;
  for (const id of removed) prices[id] = null;
  if (!Object.keys(prices).length) { toast("Nothing changed."); return; }
  $("save").disabled = true;
  try {
    await api("/api/prices", { method: "PUT", body: { prices } });
    for (const [id, p] of Object.entries(prices)) { if (p) saved[id] = p; else delete saved[id]; }
    removed = new Set();
    $("updated").textContent = `Updated ${new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    toast("Saved. Estimates use the new prices now.");
  } catch (e) { toast(e.message); }
  finally { $("save").disabled = false; }
}

// a quick start: the Lesser and Intermediate of every scroll type, for one kind of item
function addTiers(target) {
  readRows();
  for (const s of scrolls) {
    if (s.target === target && (s.tier === "Lesser" || s.tier === "Intermediate") && !rows.some((r) => r.id === s.id)) rows.push({ id: s.id, price: null });
  }
  render();
}

function showEditor(list) {
  saved = { ...list.prices };
  rows = Object.entries(saved).map(([id, price]) => ({ id: +id, price }));
  const targets = [...new Map(scrolls.map((s) => [s.target, s.name.split(" Scroll")[0].replace(/ (Attack|Accuracy|DEF|HP|MP|STR|DEX|INT|LUK|Speed|Jump|Evasion|Crit\. Rate|Crit\. Damage|Magic Attack|Armor DEF|Armor STR|Armor DEX|Armor INT|Armor LUK).*$/, "")])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  $("adminBody").innerHTML = `
    <p class="hint" id="updated">${list.updated ? `Updated ${new Date(list.updated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Not set yet."}</p>
    <div class="admin-add">
      <label>Add a scroll or item <input id="addQ" type="search" placeholder="e.g. Claw Attack, Work Gloves" autocomplete="off" /></label>
      <label>Or every Lesser + Intermediate for <select id="addTarget"><option value="">pick a kind</option>
        ${targets.map(([t, n]) => `<option value="${t}">${esc(n)}</option>`).join("")}</select></label>
    </div>
    <ul id="addResults" class="add-results"></ul>
    <ul id="priceRows" class="price-rows"></ul>
    <details class="import-box">
      <summary>Import a price file</summary>
      <p class="hint">Saved a price data file (JSON) from a price site you're allowed to use? Choose it or paste it here.
        FMCheck finds the items it knows and their prices; you check them before saving.</p>
      <input type="file" id="importFile" accept=".json,.txt,application/json" />
      <textarea id="importText" rows="4" placeholder="…or paste the file's text here" aria-label="Price file text"></textarea>
      <button type="button" class="ghost-btn" id="importGo">Read it</button>
      <p id="importMsg" class="sale-msg" role="status"></p>
    </details>
    <div class="admin-save"><button type="button" id="save">Save prices</button>
      <span class="hint">Empty = not in the list. Players' own prices always come first.</span></div>`;
  render();
  $("addQ").addEventListener("input", search);
  $("addResults").addEventListener("click", (e) => { const b = e.target.closest("[data-add]"); if (b) { add(+b.dataset.add); $("addQ").value = ""; search(); } });
  $("addTarget").addEventListener("change", (e) => { if (e.target.value) addTiers(+e.target.value); e.target.value = ""; });
  $("priceRows").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    readRows();
    const id = +b.closest(".price-row").dataset.id;
    rows = rows.filter((r) => r.id !== id);
    if (saved[id]) removed.add(id);
    render();
  });
  $("save").addEventListener("click", save);
  const runImport = (text) => {
    let data;
    try { data = JSON.parse(text); } catch { $("importMsg").textContent = "That isn't a JSON data file. Save the response that holds the prices (see the steps)."; return; }
    const r = findPrices(data, new Set([...byId.keys()]));
    if (!r.matched) { $("importMsg").textContent = `Found ${r.records} records but no prices for items FMCheck knows.`; return; }
    readRows();
    let added = 0, changed = 0;
    for (const [id, price] of Object.entries(r.prices)) {
      const row = rows.find((x) => x.id === +id);
      if (row) { if (row.price !== price) { row.price = price; changed++; } }
      else { rows.push({ id: +id, price }); added++; }
      removed.delete(+id);
    }
    render();
    $("importMsg").textContent = `Read ${r.matched} prices${r.snapshot ? ` from ${r.records.toLocaleString("en-US")} offers (middle price for scrolls, cheapest quarter for equipment; items with 3+ offers)` : ` (from "${r.priceKey}")`}: ${added} new, ${changed} changed. Check them, then press Save prices.`;
  };
  $("importFile").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) runImport(await f.text()); });
  $("importGo").addEventListener("click", () => runImport($("importText").value));
}

(async function start() {
  const [eq, sc] = await Promise.all([fetch("data/equips.json").then((r) => r.json()), fetch("data/scrolls.json").then((r) => r.json())]);
  equips = eq; scrolls = sc;
  byId = new Map([...sc.map((s) => [s.id, { name: s.name }]), ...eq.map((e) => [e[0], { name: e[1] }])]);
  const body = $("adminBody");
  const m = canSignIn() ? await me(true) : { user: null };
  if (!m.user) {
    body.innerHTML = `<p>Sign in to manage the price list.</p><div id="gbtn"></div>`;
    googleButton($("gbtn"), () => location.reload());
    return;
  }
  if (!m.admin) {
    body.innerHTML = `<p>You're signed in, but this account isn't an admin.</p>
      <p>Your account id: <code>${esc(m.user.id)}</code> <button type="button" class="ghost-btn mini" id="copyId">Copy</button></p>
      <p class="hint">To make it an admin, add this id to <code>ADMIN_IDS</code> (send it to whoever runs the site).</p>`;
    $("copyId").addEventListener("click", () => navigator.clipboard.writeText(m.user.id).then(() => toast("Copied.")).catch(() => {}));
    return;
  }
  showEditor(await api("/api/prices"));
})();
