# FMCheck

Rough price check for scrolled MapleStory Classic items.

Pick an item, set the stats it rolled clean and what such a clean item costs, say how many slots are left,
add the scrolls that passed with today's price for each, and get a ballpark value.

## How the estimate works

The estimate is the average cost to make this item from scratch:

```
estimate = (clean item price + scroll cost per try) / chance a try works
```

A try works when every scroll type passes at least as many times and no dark scroll booms the item.
The clean price is for a clean item with the chosen stats, so the roll's rarity isn't counted again.
The page also shows a loose range (70%–115% of the estimate), since shops rarely sell at exactly rebuild cost.

Clean stat ranges use the usual pre-Big-Bang rule: base ± min(ceil(10% of base), 5), or ±10 for DEF/HP/MP.
The slider for the main stat shows how rare the roll is, to help price the clean item.

## Data

| What | Source | How |
| --- | --- | --- |
| Item list, scroll list | [maplestory.io](https://maplestory.io) (GMS v83) | `data/*.json`, built by `scripts/build_data.py` |
| Item base stats, slots | maplestory.io | stored in `data/equips.json` |
| Scroll icons | maplestory.io | stored in `assets/scrolls/`, by `scripts/fetch_icons.py` |
| Prices | typed by the user | remembered in the browser |

### Prices

Users type the clean item price and each scroll's price. The site reads nothing from meso.watch or meowdb;
each price field only links to the item on meso.watch so it's easy to look up.
Scroll prices are remembered in the browser; the clean price isn't, since it depends on the stats.

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
