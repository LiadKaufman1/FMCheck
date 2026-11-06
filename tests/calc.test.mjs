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
