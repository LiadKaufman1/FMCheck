// Price list editor: set a typical price for scrolls and clean items, then export data/prices.json.
import { ITEM_API, priceLink } from "./config.js";
import { STAT_LABEL, mesos, parseMesos } from "./calc.js";
import { initPrices, getPrice, setPrice, allPrices } from "./prices.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plusList = (stats) => Object.entries(stats).map(([k, v]) => `+${v} ${STAT_LABEL[k] || k}`).join(", ");

const [equips, scrolls] = await Promise.all([
  fetch("data/equips.json").then((r) => r.json()),
  fetch("data/scrolls.json").then((r) => r.json()),
  initPrices(),
]);

// Name each scroll's item type from the items it fits, e.g. 130 -> "One-Handed Sword".
const typeName = {};
{
  const counts = {};
  for (const e of equips) {
    const t = Math.floor(e[0] / 10000);
    counts[t] ??= {};
    counts[t][e[3]] = (counts[t][e[3]] || 0) + 1;
  }
  for (const [t, c] of Object.entries(counts)) typeName[t] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}
const scrollLabel = (s) => `${typeName[s.target] || "Item"} · ${s.name.replace(/^(dark )?scroll for .*? for /i, (_, d) => (d ? "Dark " : ""))}`;

function row(id, img, title, sub) {
  const p = getPrice(id);
  return `<li data-id="${id}">
    <img src="${img}" alt="" loading="lazy" />
    <span class="nm"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
    <span class="price-input"><input inputmode="decimal" placeholder="price" value="${p ? mesos(p.value) : ""}" />
      <a href="${priceLink(id)}" target="_blank" rel="noopener">check ↗</a></span></li>`;
}

function renderScrolls() {
  const words = $("q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const onlyMissing = $("missing").checked;
  const list = scrolls.filter((s) => {
    const text = `${scrollLabel(s)} ${plusList(s.stats)}`.toLowerCase();
    return words.every((w) => text.includes(w)) && (!onlyMissing || !getPrice(s.id));
  });
  const shown = list.slice(0, 80);
  $("count").textContent = `${list.length} scrolls${list.length > shown.length ? `, showing ${shown.length}: filter to see more` : ""}`;
  $("list").innerHTML = shown.map((s) => row(s.id, `assets/scrolls/${s.id}.png`, scrollLabel(s), plusList(s.stats) + (s.boom ? " · may boom" : ""))).join("");
}

function renderItems() {
  const q = $("itemQ").value.trim().toLowerCase();
  const priced = equips.filter((e) => getPrice(e[0]));
  const found = q.length >= 2 ? equips.filter((e) => e[1].toLowerCase().includes(q)).slice(0, 20) : [];
  const shown = [...new Map([...found, ...priced].map((e) => [e[0], e])).values()];
  $("items").innerHTML = shown.map((e) => row(e[0], `${ITEM_API}/item/${e[0]}/icon`, e[1], `Lv ${e[2]} · ${e[3]}`)).join("");
}

for (const list of ["list", "items"]) {
  $(list).addEventListener("change", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || e.target.tagName !== "INPUT") return;
    const v = parseMesos(e.target.value);
    setPrice(+li.dataset.id, e.target.value.trim() === "" ? NaN : v);
    if (Number.isFinite(v)) e.target.value = mesos(v);
    $("saved").textContent = "Saved in this browser.";
  });
}
$("q").addEventListener("input", renderScrolls);
$("missing").addEventListener("change", renderScrolls);
$("itemQ").addEventListener("input", renderItems);

const exportJson = () => JSON.stringify({ updated: new Date().toISOString(), source: "MesoWatch", prices: allPrices() }, null, 1);
$("download").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
  a.download = "prices.json";
  a.click();
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(exportJson()); $("saved").textContent = "Copied."; }
  catch { $("saved").textContent = "Couldn't copy here; use Download."; }
});

document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.style.visibility = "hidden"; }, true);
renderScrolls();
renderItems();
