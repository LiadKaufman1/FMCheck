import { test } from "node:test";
import assert from "node:assert/strict";
import { statRange, rollAtLeast, groupOdds, estimate, finalStats, mesos, parseMesos } from "../js/calc.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("stat ranges", () => {
  assert.deepEqual(statRange("PAD", 48), [43, 53]);   // capped at ±5
  assert.deepEqual(statRange("PAD", 17), [15, 19]);   // ceil(1.7) = 2
  assert.deepEqual(statRange("PDD", 150), [140, 160]); // DEF caps at ±10
  assert.deepEqual(statRange("STR", 0), [0, 0]);
});

test("roll chance", () => {
  close(rollAtLeast("PAD", 48, 43), 1);
  close(rollAtLeast("PAD", 48, 53), 1 / 11);
  close(rollAtLeast("PAD", 48, 54), 0);
});

test("scroll odds", () => {
  close(groupOdds(7, 7, 100), 1);
  close(groupOdds(1, 1, 60), 0.6);
  close(groupOdds(2, 1, 60), 1 - 0.4 ** 2);
  close(groupOdds(1, 0, 30, 50), 0.3 + 0.7 * 0.5); // dark scroll: half of failures boom
  close(groupOdds(3, 0, 10), 1);
});

test("estimate", () => {
  const r = estimate({ cleanPrice: 1e6, groups: [{ used: 1, successes: 1, success: 10, price: 1e6 }] });
  close(r.tryCost, 2e6);
  close(r.chance, 0.1);
  close(r.value, 2e7);
  const none = estimate({ cleanPrice: 5e5, groups: [] });
  close(none.value, 5e5);
});

test("final stats", () => {
  assert.deepEqual(finalStats({ PAD: 50 }, [{ successes: 3, stats: { PAD: 2, STR: 1 } }]), { PAD: 56, STR: 3 });
});

test("meso format and parse", () => {
  assert.equal(mesos(1234567), "1.23m");
  assert.equal(mesos(45000), "45k");
  assert.equal(parseMesos("12m"), 12e6);
  assert.equal(parseMesos("1.5b"), 1.5e9);
  assert.equal(parseMesos("45,000"), 45000);
  assert.ok(Number.isNaN(parseMesos("abc")));
});

import { allocateFailures } from "../js/calc.js";
test("failed slots go where failing is most likely", () => {
  assert.deepEqual(allocateFailures([{ successes: 5, success: 60 }], 2), [2]);
  // a 10% scroll fails far more often than a 100% one
  assert.deepEqual(allocateFailures([{ successes: 1, success: 100 }, { successes: 1, success: 10 }], 3), [0, 3]);
  assert.deepEqual(allocateFailures([], 3), []);
});

import { readPrice, splitPrice } from "../js/calc.js";
test("price fields with a unit dropdown", () => {
  assert.equal(readPrice("1.98", "m"), 1980000);
  assert.equal(readPrice("50", "k"), 50000);
  assert.equal(readPrice("750", ""), 750);
  assert.equal(readPrice("2m", "k"), 2e6); // typed unit wins
  assert.ok(Number.isNaN(readPrice("", "m")));
  assert.deepEqual(splitPrice(1980000), { num: "1.98", unit: "m" });
  assert.deepEqual(splitPrice(500), { num: "500", unit: "" });
});

import { readRange } from "../js/calc.js";
test("price ranges", () => {
  assert.deepEqual(readRange("1.8", "2", "m"), { lo: 1.8e6, hi: 2e6 });
  assert.deepEqual(readRange("50", "", "k"), { lo: 50000, hi: 50000 });   // one box = exact price
  assert.deepEqual(readRange("", "60", "k"), { lo: 60000, hi: 60000 });
  assert.deepEqual(readRange("2", "1.8", "m"), { lo: 1.8e6, hi: 2e6 });  // reversed gets sorted
  assert.equal(readRange("", "", "m"), null);
});

import { openSlotValue } from "../js/calc.js";
test("open slots add value", () => {
  // 10m item from a 2m clean, +8 gained -> 1m per point. Intermediate: 60% × 2 points × 1m − 0.4m = 0.8m per slot.
  const r = openSlotValue({ value: 10e6, cleanPrice: 2e6, pointsGained: 8, slotsLeft: 2, ref: { success: 60, points: 2, price: 4e5 } });
  assert.equal(Math.round(r.perSlot), 800000);
  assert.equal(Math.round(r.total), 1600000);
  // no open slots or nothing passed: nothing added
  assert.equal(openSlotValue({ value: 10e6, cleanPrice: 2e6, pointsGained: 8, slotsLeft: 0, ref: { success: 60, points: 2, price: 4e5 } }).total, 0);
  assert.equal(openSlotValue({ value: 2e6, cleanPrice: 2e6, pointsGained: 0, slotsLeft: 3, ref: null }).total, 0);
  // a scroll too pricey for what it adds is worth 0, not negative
  assert.equal(openSlotValue({ value: 3e6, cleanPrice: 2e6, pointsGained: 8, slotsLeft: 1, ref: { success: 60, points: 2, price: 5e6 } }).total, 0);
});

import { cheapestRoute } from "../js/calc.js";
const L = { fam: "A", points: 1, success: 100, boom: 0, id: 1 };
const I = { fam: "A", points: 2, success: 60, boom: 0, id: 2 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, b), `${a} != ${b}`);
test("cheapest route: guaranteed Lesser", () => {
  const r = cheapestRoute({ cleanPrice: 100, slots: 3, needs: { A: 3 }, tiers: [{ ...L, price: 10 }] });
  near(r.cost, 130); near(r.chance, 1);
});
test("cheapest route: one Intermediate, retry on fail", () => {
  const r = cheapestRoute({ cleanPrice: 100, slots: 1, needs: { A: 2 }, tiers: [{ ...I, price: 10 }] });
  near(r.cost, 110 / 0.6); near(r.chance, 0.6);
});
test("cheapest route picks the cheaper tier", () => {
  // +3 in 3 slots: Lessers cost 3×10; Intermediate would be pricier
  const r = cheapestRoute({ cleanPrice: 100, slots: 3, needs: { A: 3 }, tiers: [{ ...L, price: 10 }, { ...I, price: 50 }] });
  near(r.cost, 130);
  // +4 in 3 slots needs at least one Intermediate pass, so it costs more than all-Lesser +3
  const r2 = cheapestRoute({ cleanPrice: 100, slots: 3, needs: { A: 4 }, tiers: [{ ...L, price: 10 }, { ...I, price: 50 }] });
  assert.ok(r2.cost > 130 && r2.chance < 1);
});
test("cheapest route: nothing needed or nothing priced", () => {
  near(cheapestRoute({ cleanPrice: 100, slots: 3, needs: {}, tiers: [] }).cost, 100);
  assert.equal(cheapestRoute({ cleanPrice: 100, slots: 3, needs: { A: 2 }, tiers: [] }), null);
  assert.equal(cheapestRoute({ cleanPrice: 100, slots: 1, needs: { A: 3 }, tiers: [{ ...I, price: 10 }] }), null); // can't reach
});

import { failedItemValue } from "../js/calc.js";
test("failed slots lower a clean item's value", () => {
  const at = (left) => failedItemValue({ cleanPrice: 1000, slots: 5, left }).value;
  assert.equal(at(5), 1000);       // nothing failed: clean price
  near(at(4), 820);                // one of five slots lost: 10% + 90% × 4/5
  near(at(0), 100);                // all failed: base stats keep 10%
  assert.ok(at(3) < at(4));
});

import { inferScrolls } from "../js/calc.js";
test("reading a finished item: which scrolls passed", () => {
  const S = (id, k, v, success) => ({ id, stats: { [k]: v }, success });
  const glove = [S(1, "CRT", 1, 100), S(2, "CRT", 2, 60), S(3, "CRT", 3, 10), S(4, "CRT", 4, 10), S(5, "PAD", 1, 100), S(6, "PAD", 2, 60)];
  // Work Gloves (+1), Crit (1 +4): one pass for +4 can only be the Chaos-like +4 scroll
  const one = inferScrolls({ gains: { CRT: 4 }, passes: 1, used: 1, scrolls: glove });
  assert.equal(one.length, 1); assert.equal(one[0].rows[0].scroll.id, 4);
  // +4 ATT in two passes: two of the +2 scroll
  const two = inferScrolls({ gains: { PAD: 4 }, passes: 2, used: 3, scrolls: glove });
  assert.equal(two[0].rows[0].scroll.id, 6); assert.equal(two[0].rows[0].n, 2);
  // two stats at once
  const mix = inferScrolls({ gains: { PAD: 2, CRT: 1 }, passes: 2, used: 2, scrolls: glove });
  assert.ok(mix[0].rows.some((r) => r.scroll.id === 6) && mix[0].rows.some((r) => r.scroll.id === 1)); // +2 ATT scroll and +1 Crit scroll
  // nothing gained
  assert.deepEqual(inferScrolls({ gains: {}, passes: 0, used: 2, scrolls: glove })[0].rows, []);
});

import { parseTooltip } from "../js/reader.js";
test("reading a tooltip's text", () => {
  const equips = [[1082000, "Work Gloves", 10, "Glove", 5, { PDD: 6, CRT: 1 }, {}], [1472018, "Steel Slain", 50, "Claw", 7, { PAD: 34 }, {}]];
  const text = `Work Gloves (+1)
REQ LEV : 10
REQ STR : 0
BEGINNER WARRIOR MAGICIAN BOWM
Type: Gloves
Weapon Def.: +6 34,966
Critical Rate: +5 (1 +4)
Remaining Enhancements: 4`;
  const r = parseTooltip(text, equips);
  assert.equal(r.item[0], 1082000);
  assert.equal(r.upgrades, 1);
  assert.equal(r.left, 4);
  assert.deepEqual(r.stats.CRT, { total: 5, base: 1, gain: 4 });
  assert.deepEqual(r.stats.PDD, { total: 6, base: 6, gain: 0 });
  // OCR slips in the name still find the item
  const r2 = parseTooltip("Stee1 Sla1n (+4)\nWeapon Att.: +42 (34 +8)\nRemaining Enhancements: 1", equips);
  assert.equal(r2.item[0], 1472018);
  assert.deepEqual(r2.stats.PAD, { total: 42, base: 34, gain: 8 });
});

test("tooltip without a readable name: item found from its stats", () => {
  const equips = [[1082000, "Work Gloves", 10, "Glove", 5, { PDD: 6, CRT: 1 }, {}], [1472018, "Steel Slain", 50, "Claw", 7, { PAD: 34 }, {}]];
  const r = parseTooltip("W@rk Glo\nType: Glove\nWeapon Def.: +6\nCritical Rate: +5 (1 +4)\nRemaining Enhancements: 4", equips);
  assert.equal(r.item[0], 1082000);
  assert.deepEqual(r.stats.CRT, { total: 5, base: 1, gain: 4 });
});

test("the game's brackets are default ± (roll + scrolls)", () => {
  const S = (id, stats, success, tier) => ({ id, stats, success, tier });
  const overall = [S(1, { PDD: 2 }, 100, "Lesser"), S(2, { PDD: 4, MDD: 2 }, 60, "Intermediate"), S(3, { PDD: 6, MDD: 4 }, 10, "Greater"),
    S(4, { STR: 1 }, 100, "Lesser")];
  // Dark Crusader Chainmail (+1): W.DEF 117 (115 +2), M.DEF 14 (10 +4): one Intermediate (+4/+2) with rolls -2/+2
  const r = inferScrolls({ gains: { PDD: 2, MDD: 4, STR: 0 }, tol: { PDD: 11, MDD: 2, STR: 2 }, passes: 1, used: 5, scrolls: overall });
  // Intermediate (+4/+2, rolls -2/+2) and Greater (+6/+4, rolls -4/0) both fit; both are offered
  assert.deepEqual(r.map((o) => o.rows[0].scroll.id).sort(), [2, 3]);
  // exact numbers still work with no tolerance
  const g = inferScrolls({ gains: { CRT: 4 }, passes: 1, used: 1, scrolls: [S(9, { CRT: 4 }, 10, "Chaos"), S(8, { CRT: 1 }, 100, "Lesser")] });
  assert.equal(g[0].rows[0].scroll.id, 9);
});

test("small stats: a roll past the usual range is rare, so Chaos +4 beats Intermediate +2 on Crit (1 +4)", () => {
  const S = (id, v, success, tier) => ({ id, stats: { CRT: v }, success, tier });
  const crit = [S(1, 1, 100, "Lesser"), S(2, 2, 60, "Intermediate"), S(3, 3, 10, "Greater"), S(4, 4, 10, "Chaos")];
  const r = inferScrolls({ gains: { CRT: 4 }, tol: { CRT: 2 }, passes: 1, used: 1, scrolls: crit });
  assert.equal(r[0].rows[0].scroll.id, 4);
});

import { mergeReadings } from "../js/reader.js";
test("several readings vote", () => {
  const A = { item: null, confidence: 0, upgrades: 1, left: 3, stats: { PDD: { total: 117, base: 115, gain: 2 } }, suggestions: [] };
  const B = { item: [1, "Dark Crusader Chainmail"], confidence: 1, upgrades: 1, left: 5, stats: { PDD: { total: 117, base: 115, gain: 2 }, MDD: { total: 14, base: 10, gain: 4 } } };
  const C = { item: null, confidence: 0, upgrades: null, left: 5, stats: {} };
  const m = mergeReadings([A, B, C]);
  assert.equal(m.item[1], "Dark Crusader Chainmail");
  assert.equal(m.left, 5);         // 5 twice, 3 once
  assert.equal(m.upgrades, 1);
  assert.deepEqual(m.stats.MDD, { total: 14, base: 10, gain: 4 });
});
