// What goes on an item card (drawn by card.js), shared by the calculator and the community page.
import { mesos } from "./calc.js?v=7adea26c";

export const GAME_LABEL = { STR: "STR", DEX: "DEX", INT: "INT", LUK: "LUK", MHP: "MaxHP", MMP: "MaxMP", PAD: "Weapon Att.",
  MAD: "Magic Att.", PDD: "Weapon Def.", MDD: "Magic Def.", ACC: "Accuracy", EVA: "Avoidability", Speed: "Speed",
  Jump: "Jump", CRT: "Critical Rate", CRD: "Critical Damage" };
export const GAME_ORDER = ["STR", "DEX", "INT", "LUK", "MHP", "MMP", "PAD", "MAD", "PDD", "MDD", "ACC", "EVA", "Speed", "Jump", "CRT", "CRD"];

export const rangeText = (lo, hi) => (lo === hi ? mesos(lo) : `${mesos(lo)} – ${mesos(hi)}`);
export const pct = (x) => (x >= 0.995 ? "100%" : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toPrecision(2)}%`);
export const oneInText = (n) => (n < 1.05 ? "almost every try" : `1 in ${n < 1e6 ? Math.round(n).toLocaleString("en-US") : mesos(n)}`);
export const cardFmt = { range: rangeText, pct, oneIn: oneInText };
export const cardDate = (t = Date.now()) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// equip: a row of data/equips.json. fin: final stats, clean: the clean roll. scrolls: [{ n, name }].
export function cardInfo({ equip, fin, clean, left, upgrades, price, chance, oneIn, scrolls, date, priceHint, footer }) {
  const extra = (equip && equip[6]) || {};
  return {
    name: equip[1],
    upgrades,
    icon: `assets/items/${String(equip[0]).padStart(8, "0")}.png`,
    level: equip[2] || 0,
    req: extra.req || [0, 0, 0, 0],
    jobs: extra.jobs || null,
    type: equip[3],
    stats: GAME_ORDER.filter((k) => fin[k]).map((k) => ({
      label: GAME_LABEL[k], total: fin[k], base: clean[k] || 0, gain: fin[k] - (clean[k] || 0),
    })),
    left,
    price,
    priceHint,
    date: date || cardDate(),
    chance,
    oneIn,
    scrolls,
    footer,
  };
}

// The same card as words, for screen readers.
export const cardLabel = (d) => `${d.name}${d.upgrades ? ` (+${d.upgrades})` : ""}: `
  + `${d.stats.map((s) => `${s.label} ${s.total}`).join(", ") || "no stats"}, ${d.left} slots left. `
  + `Estimated price ${d.price ? rangeText(d.price.lo, d.price.hi) : "not available yet"}. Chance of an item like this ${pct(d.chance)}.`;
