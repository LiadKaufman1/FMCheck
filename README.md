# FMCheck

Rough price check for scrolled MapleStory Classic items.

Pick an item, set the stats it rolled clean, say how many slots are left and which scrolls passed,
and get a ballpark value. Prices come from the price list, so users don't type them.

## How the estimate works

The estimate is the average cost to make an item at least this good from scratch:

```
estimate = (clean item price + scroll cost per try) / chance a try works
```

A try works when the clean roll of the chosen stat (ATT on most weapons) is at least as high,
every scroll group passes at least as many times, and no dark scroll booms the item.
The page also shows a loose range (70%–115% of the estimate), since shops rarely sell at exactly rebuild cost.

Clean stat ranges use the usual pre-Big-Bang rule: base ± min(ceil(10% of base), 5), or ±10 for DEF/HP/MP.
Rolls are treated as evenly spread over that range.

## Data

| What | Source | How |
| --- | --- | --- |
| Item list, scroll list | [maplestory.io](https://maplestory.io) (GMS v83) | `data/*.json`, built by `scripts/build_data.py` |
| Item base stats, slots | maplestory.io | stored in `data/equips.json` |
| Scroll icons | maplestory.io | stored in `assets/scrolls/`, by `scripts/fetch_icons.py` |
| Prices | price list filled from `prices.html` | `data/prices.json`, see below |

### Prices

The calculator reads `data/prices.json` (item id → typical price in mesos).
Fill it from **prices.html** (not linked from the main page): type a price per scroll and clean item,
using "check ↗" to look each one up on meso.watch, then download the file and commit it as `data/prices.json`.

meso.watch and meowdb.com don't allow automated collection of their data (see meso.watch/terms),
so the list is filled by hand until they give permission or an official feed. With a feed,
set `PRICE_FEED_URL` in `js/config.js` to it.

Failed scrolls aren't entered: the page works them out from the slots left and spreads them over
the passed scroll types in the most likely way.

## Run locally

```
npm start          # serves on http://localhost:8000
npm test           # unit tests for the math
npm run data       # rebuild data/equips.json and data/scrolls.json
python3 scripts/fetch_icons.py   # download scroll icons into assets/scrolls/
```

It's a static site (no build step), so it can be hosted as-is on GitHub Pages, Netlify or Cloudflare Pages.
