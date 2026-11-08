import { test } from "node:test";
import assert from "node:assert/strict";
import { findPrices } from "../js/priceimport.js";

const known = new Set([2044701, 1082000, 2040815]);

test("finds ids and prices in different shapes of price files", () => {
  const a = findPrices({ items: [{ id: "02044701", name: "Claw Attack Scroll", typical: 385000 }, { id: 9999999, typical: 5 }] }, known);
  assert.deepEqual(a.prices, { 2044701: 385000 });
  const b = findPrices([{ itemId: 1082000, stats: { median: "300,000" } }, { item_id: 2040815, price: { typical: 90000 } }], known);
  assert.deepEqual(b.prices, { 1082000: 300000, 2040815: 90000 });
  assert.equal(findPrices({ nothing: true }, known).matched, 0);
});

test("a market snapshot: many offers per item become one price (scroll: middle, equipment: cheapest quarter)", () => {
  const rows = [];
  for (const p of [380000, 400000, 420000, 9999999]) rows.push({ id: "basil:02044701", seller: "x", price: p });
  for (const p of [1500, 1600, 2000, 8000000]) rows.push({ id: "basil:01082000", seller: "y", price: p });
  rows.push({ id: "basil:02040815", price: 90000 }); // one offer only: left out
  rows.push({ id: "cash:01082000", price: 5 });      // cash items aren't these ids
  const r = findPrices({ rows }, known);
  assert.equal(r.snapshot, true);
  assert.equal(r.prices[2044701], 410000);
  assert.equal(r.prices[1082000], 1575);
  assert.equal(r.prices[2040815], undefined);
});
