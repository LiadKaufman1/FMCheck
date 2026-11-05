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
