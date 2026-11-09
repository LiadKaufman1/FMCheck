// Item search shared by the calculator and the community page: category chips like the game's equip tabs,
// a class filter, and a search box that suggests items (with their icons) as you type.
import { iconUrl } from "./config.js?v=e4efec93";

// Categories like the game's equip tabs. Icon = a typical item of that kind.
export const CATS = [["", "All", null], ["Weapon", "Weapons", 1302000], ["Hat", "Hats", 1002012], ["Top", "Tops", 1040002],
  ["Bottom", "Bottoms", 1060001], ["Overall", "Overalls", 1050010], ["Shoes", "Shoes", 1072083], ["Glove", "Gloves", 1082000],
  ["Shield", "Shields", 1092001], ["Cape", "Capes", 1102000], ["Earring", "Earrings", 1032007]];
export const catOf = (e) => (Math.floor(e[0] / 10000) >= 130 ? "Weapon" : e[3]);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// cats, input, results, job: the elements. onPick(equip): an item was chosen. onChange(filter): a category or class was chosen.
// isPicked(): the box shows a chosen item (browsing again clears it). count(key, filter): the number on a chip
// (default: how many items of that kind exist). noun: what the chip numbers count, for screen readers.
// badge(equip): a number to show on a suggestion (the community: how many are up); items with one come first.
export function itemSearch({ cats, input, results, job, idPrefix = "opt", onPick, onChange = () => {}, isPicked = () => false,
  count = null, noun = "items", badge = null, badgeText = (n) => `${n}` }) {
  let equips = [], matches = [], active = 0, hideTimer;
  const filter = { cat: "", job: "" };
  const jobOk = (e) => !filter.job || !(e[6] && e[6].jobs) || e[6].jobs.includes(filter.job);
  const inFilter = (e) => (!filter.cat || catOf(e) === filter.cat) && jobOk(e);

  function renderCats() {
    cats.innerHTML = CATS.map(([key, label, id]) => {
      const n = count ? count(key, filter) : equips.filter((e) => (!key || catOf(e) === key) && jobOk(e)).length;
      return `<button type="button" class="cat${filter.cat === key ? " on" : ""}" data-cat="${key}" title="${label}"
        aria-label="${label}${n != null ? `, ${n} ${noun}` : ""}" aria-pressed="${filter.cat === key}">
        ${id ? `<img src="${iconUrl(id)}" alt="" />` : `<span class="all">ALL</span>`} ${n != null ? `<small>${n}</small>` : ""}</button>`;
    }).join("");
  }

  // Text: name starts with it, then a word in the name starts with it, then anywhere (also the item type, e.g. "claw").
  // No text but a category or class picked: list them all by level.
  function findItems(q) {
    q = q.trim().toLowerCase();
    const pool = equips.filter(inFilter);
    const up = (e) => (badge && badge(e) ? 1 : 0);
    if (!q) return filter.cat || filter.job ? pool.slice().sort((a, b) => up(b) - up(a) || a[2] - b[2] || a[1].localeCompare(b[1])).slice(0, 300) : [];
    const starts = [], word = [], has = [];
    for (const e of pool) {
      const n = e[1].toLowerCase(), t = e[3].toLowerCase();
      if (n.startsWith(q)) starts.push(e);
      else if (n.includes(" " + q) || n.includes("-" + q) || t.startsWith(q)) word.push(e);
      else if (q.length > 1 && (n.includes(q) || t.includes(q))) has.push(e);
    }
    const all = starts.concat(word, has);
    if (badge) all.sort((a, b) => up(b) - up(a)); // stable: keeps the text order within each group
    return all.slice(0, 60);
  }

  const hide = () => { results.hidden = true; input.setAttribute("aria-expanded", "false"); };
  function showResults() {
    clearTimeout(hideTimer);
    if (isPicked()) { hide(); return; }
    matches = findItems(input.value);
    active = 0;
    results.hidden = !matches.length && !(filter.cat || filter.job || input.value.trim());
    input.setAttribute("aria-expanded", String(!results.hidden));
    if (matches.length) input.setAttribute("aria-activedescendant", `${idPrefix}-0`); else input.removeAttribute("aria-activedescendant");
    results.innerHTML = matches.length ? matches.map((e, i) =>
      `<li role="option" id="${idPrefix}-${i}" data-i="${i}" aria-selected="${i === 0}">
        <img loading="lazy" src="${iconUrl(e[0])}" alt="" /><span>${esc(e[1])}</span>
        <span class="meta">${badge && badge(e) ? `<b class="up">${badgeText(badge(e))}</b> · ` : ""}Lv ${e[2]} · ${esc(e[3])}</span></li>`).join("")
      : `<li class="none" role="option" aria-disabled="true">No items match. Try another category or class.</li>`;
  }

  function moveActive(d) {
    if (!matches.length) return;
    active = (active + d + matches.length) % matches.length;
    [...results.children].forEach((li, i) => li.setAttribute("aria-selected", i === active));
    input.setAttribute("aria-activedescendant", `${idPrefix}-${active}`);
    results.children[active].scrollIntoView({ block: "nearest" });
  }
  const pick = (e) => { hide(); onPick(e); };

  input.addEventListener("input", showResults);
  input.addEventListener("focus", () => { if (filter.cat || filter.job || input.value.trim()) showResults(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter" && !results.hidden && matches[active]) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === "Escape") hide();
  });
  results.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); pick(matches[+li.dataset.i]); }
  });
  input.addEventListener("blur", () => { hideTimer = setTimeout(hide, 150); });

  // Chips keep the focus in the search box, so the list stays open while browsing.
  const browse = () => {
    renderCats();
    if (isPicked()) input.value = ""; // browsing again after a pick
    onChange(filter);
    input.focus();
    showResults();
  };
  cats.addEventListener("mousedown", (e) => { if (e.target.closest(".cat")) e.preventDefault(); });
  cats.addEventListener("click", (e) => {
    const b = e.target.closest(".cat");
    if (!b) return;
    filter.cat = filter.cat === b.dataset.cat ? "" : b.dataset.cat;
    browse();
  });
  job.addEventListener("change", (e) => { filter.job = e.target.value; browse(); });

  return {
    filter, renderCats, showResults, hide,
    setEquips(list) { equips = list; renderCats(); if (input.value.trim() && document.activeElement === input) showResults(); },
  };
}
