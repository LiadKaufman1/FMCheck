# FMCheck

Rough price check for scrolled MapleStory Classic items.

Pick an item, set the stats it rolled clean, add the scrolls that were used (and how many passed),
enter today's prices, and get a ballpark value.

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
| Item base stats, slots, icons | maplestory.io | fetched by the page when an item is picked |
| Prices | typed by the user, saved in the browser | optional live feed, see below |

### Live prices

meso.watch and meowdb.com both sit behind Cloudflare bot protection and have no public API,
so the page can't read their prices on its own. Each price field has a "check ↗" link that opens the item on meso.watch.

To plug in live prices, set `PRICE_FEED_URL` in `js/config.js` to a JSON file shaped like:

```json
{ "updated": "2026-11-05T08:00:00Z", "prices": { "2043001": 1500000, "1302020": 300000 } }
```

(item id → typical sale price in mesos). Prices the user types always win over the feed.

## Run locally

```
npm start          # serves on http://localhost:8000
npm test           # unit tests for the math
npm run data       # rebuild data/equips.json and data/scrolls.json
```

It's a static site (no build step), so it can be hosted as-is on GitHub Pages, Netlify or Cloudflare Pages.
