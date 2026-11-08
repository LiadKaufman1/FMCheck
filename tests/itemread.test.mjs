// Reading an item window: text from two real pictures (a screenshot and a camera photo of a screen).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseWindow, findItem, guessScrolls } from "../js/itemread.js";

const load = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url)));
const equips = load("../data/equips.json");
const scrolls = load("../data/scrolls.json");
const text = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const names = (rows) => rows.map((r) => `${r.n}x ${scrolls.find((s) => s.id === r.id).name}`);

test("Work Gloves (+1) from a screenshot: one Crit pass, Chaos likeliest", () => {
  const read = parseWindow(text("work-gloves-screenshot.txt"));
  assert.deepEqual(read.stats, { PDD: 6, CRT: 5 });
  assert.equal(read.left, 4);
  const item = findItem(read, equips)[0].e;
  assert.equal(item[1], "Work Gloves");
  const g = guessScrolls(item, read, scrolls);
  assert.equal(g.left, 4);
  assert.deepEqual(names(g.best.rows), ["1x Gloves Crit. Rate Scroll: Chaos"]);
  assert.equal(g.best.clean.CRT, 1);
  assert.deepEqual(names(g.others[0].rows), ["1x Gloves Crit. Rate Scroll: Greater"]);
});

test("Dark Crusader Chainmail (+1) from a camera photo: the only scroll that fits is DEF Greater", () => {
  const read = parseWindow(text("dark-crusader-photo.txt"));
  assert.equal(read.stats.PDD, 117);
  assert.equal(read.stats.MDD, 14);
  assert.equal(read.left, 5);
  assert.equal(read.upgrades, 1);
  const item = findItem(read, equips)[0].e;
  assert.equal(item[1], "Dark Crusader Chainmail");
  const g = guessScrolls(item, read, scrolls);
  assert.deepEqual(names(g.best.rows), ["1x Overall Armor DEF Scroll: Greater"]);
  assert.equal(g.best.clean.PDD, 111);
  assert.equal(g.best.clean.MDD, 10);
});

test("a stat line with misread letters still counts", () => {
  const r = parseWindow("x Véeaporn Det #117 (1156 +.)\nE. { Magic Daf: +14 (10-2)\nFermainimg Enhancements 5");
  assert.deepEqual(r.stats, { PDD: 117, MDD: 14 });
  assert.equal(r.left, 5);
});

test("a number split by a space is read whole, and 'Types' isn't a type", () => {
  const r = parseWindow("Type: Outfit 7\n| \"\\Waapon Det. +1 17 (115 +2) be\nTypes Cnateit");
  assert.equal(r.stats.PDD, 117);
  assert.equal(r.type, "Overall");
});
