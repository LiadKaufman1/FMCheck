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
