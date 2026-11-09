import { test } from "node:test";
import assert from "node:assert/strict";
import { rarity, tierOf, oneInText } from "../js/rarity.js";

test("a default clean roll and no scrolls is common", () => {
  const r = rarity({ base: { PAD: 73 }, clean: { PAD: 73 }, used: 0, rows: [] });
  assert.equal(r.chance, 1);
  assert.equal(r.tier.name, "Common");
});

test("only stats above the default make it rarer", () => {
  const top = rarity({ base: { PAD: 73, PDD: 50 }, clean: { PAD: 78, PDD: 45 } });
  assert.equal(top.rollParts.length, 1);
  assert.ok(Math.abs(top.oneIn - 11) < 1e-9); // 78 is the best of 68..78
});

test("scrolls: one Chaos pass in one slot is 1 in 10 (with the item kept)", () => {
  const r = rarity({ base: { CRT: 1 }, clean: { CRT: 1 }, used: 1, rows: [{ successes: 1, success: 10, boom: 50 }] });
  assert.ok(Math.abs(r.oneIn - 10) < 1e-6);
  assert.equal(r.tier.name, "Uncommon");
});

test("tiers and text", () => {
  assert.equal(tierOf(4.9).name, "Common");
  assert.equal(tierOf(50).name, "Rare");
  assert.equal(tierOf(6000).name, "Legendary");
  assert.equal(oneInText(3400), "1 in 3,400");
  assert.equal(oneInText(2.1e6), "1 in 2.1M");
  assert.equal(oneInText(1.47), "1 in 1.5");
});
