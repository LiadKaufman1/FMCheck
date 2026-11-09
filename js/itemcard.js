// What goes on an item card (drawn by card.js), shared by the calculator and the community page.
import { mesos } from "./calc.js?v=61f49576";
import { oneInText as rareText } from "./rarity.js?v=61f49576";

export const GAME_LABEL = { STR: "STR", DEX: "DEX", INT: "INT", LUK: "LUK", MHP: "MaxHP", MMP: "MaxMP", PAD: "Weapon Att.",
  MAD: "Magic Att.", PDD: "Weapon Def.", MDD: "Magic Def.", ACC: "Accuracy", EVA: "Avoidability", Speed: "Speed",
  Jump: "Jump", CRT: "Critical Rate", CRD: "Critical Damage" };
export const GAME_ORDER = ["STR", "DEX", "INT", "LUK", "MHP", "MMP", "PAD", "MAD", "PDD", "MDD", "ACC", "EVA", "Speed", "Jump", "CRT", "CRD"];

export const rangeText = (lo, hi) => (lo === hi ? mesos(lo) : `${mesos(lo)} – ${mesos(hi)}`);
export const pct = (x) => (x >= 0.995 ? "100%" : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toPrecision(2)}%`);
export const oneInText = (n) => (n < 1.05 ? "almost every try" : `1 in ${n < 1e6 ? Math.round(n).toLocaleString("en-US") : mesos(n)}`);
export const cardFmt = { range: rangeText, pct, oneIn: rareText, mesos };
export const cardDate = (t = Date.now()) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// equip: a row of data/equips.json. fin: final stats, clean: the clean roll. scrolls: [{ n, name }].
// rarity: from js/rarity.js. askPrice: the seller's price (or null). seller: their in-game name (or "").
export function cardInfo({ equip, fin, clean, left, upgrades, rarity, scrolls, date, askPrice = null, seller = "", footer = "fmcheck.org" }) {
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
    rarity,
    askPrice,
    seller,
    date: date || cardDate(),
    scrolls,
    footer,
  };
}

// The same card as words, for screen readers.
export const cardLabel = (d) => `${d.name}${d.upgrades ? ` (+${d.upgrades})` : ""}: `
  + `${d.stats.map((s) => `${s.label} ${s.total}`).join(", ") || "no stats"}, ${d.left} slots left. `
  + `${d.rarity.tier.name}: ${rareText(d.rarity.oneIn)}.${d.askPrice ? ` For sale for ${mesos(d.askPrice)}.` : ""}`;
