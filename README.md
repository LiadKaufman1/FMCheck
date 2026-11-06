# FMCheck

Rough price check for scrolled MapleStory Classic items.

Pick an item, set the stats it rolled clean and what such a clean item costs, say how many slots are left,
add the scrolls that passed with today's price for each, and get a ballpark value.

## How the estimate works

A buyer won't pay more than it would cost to make an item at least this good themselves, the cheapest way,
so the estimate is that cost plus what the open slots are worth. The page shows the exact formulas under
"How is this worked out?"; the code is `cheapestRoute` and `openSlotsBonus` in `js/calc.js`.

- **Cheapest way to make one (M):** reach at least the same stat points within the same used slots, using the
  scrolls the user entered plus the Lesser and Intermediate of the same scroll (asked for under Scrolls). So only the
  result counts: the same final stats and slots left give the same price whatever was actually used. The maker picks the best scroll each step, stops at the goal, and
  drops an item that can't reach it (or that a Chaos scroll destroyed) and starts over with a new clean item.
  Solved as an expected-cost recursion with M on both sides, repeated until it settles.
- **Open slots:** what the chance to keep scrolling them is worth: the best of selling now or scrolling one more
  slot (pass, fail, or a Chaos scroll destroying it), looking up to 6 slots ahead (`openSlotsBonus`).
- **Estimate** = M + open slots, worked out with all "from" prices and all "to" prices for the range.

A failed scroll uses up its slot (checked in game).

## Data

Item and scroll data comes from the [OSMS Data Explorer](https://osmsdataexplorer.com) public dataset
for MapleStory Classic World (by @ohmi, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)),
extracted from the game client. `scripts/build_data.py` turns it into:

- `data/equips.json`: every equip with upgrade slots, with its base stats
- `data/scrolls.json`: every scroll, with success rate, destroy rate (Chaos scrolls) and stat gains
- `data/source.json`: the client build and date of the data

Icons are copied into `assets/items/` by `scripts/fetch_icons.py`, so visits don't load them from osmsdataexplorer.com. Item ids and names match meso.watch, so "check price" opens the right item there.

> Data from OSMS Data Explorer (https://osmsdataexplorer.com), CC BY 4.0. Game content © Nexon.

### Prices

Users type the clean item price and each scroll's price. The site reads nothing from meso.watch or meowdb;
each price field only links to the item on meso.watch so it's easy to look up.
Scroll prices are remembered in the browser; the clean price isn't, since it depends on the stats.

Failed scrolls aren't entered: the page works them out from the slots left and spreads them over
the passed scroll types in the most likely way.

### Reported sales

Players can report what they really sold or bought an item for (under the estimate). The latest reports for the
item show on the page, and they're collected to check and tune the formula against the market.

The small server in `src/worker.js` (Cloudflare Worker) serves the site and the API:

- `POST /api/sales` add a report · `GET /api/sales?item=ID` latest reports · `GET /api/sales/all` all reports, paged with `?cursor=`
- Reports are kept in Workers KV (binding `SALES` in `wrangler.jsonc`). Without it, the API says so and the page hides the feature.
- Anonymous: no names, accounts or IPs. Spam limit: 20 reports a day per visitor, counted by a one-way hash of the IP that expires after a day.

### Staying up to date

`.github/workflows/refresh-data.yml` runs every Monday: it rebuilds the data from the latest OSMS dataset, copies any
new icons, re-stamps the files and commits if anything changed, so Cloudflare deploys it. It can also be run by hand
from the Actions tab.

## Run locally

```
npm start          # serves on http://localhost:8000
npm test           # unit tests for the math
npm run data       # rebuild data/*.json from the latest OSMS dataset
python3 scripts/fetch_icons.py   # copy any new item/scroll icons into assets/items/
python3 scripts/stamp.py   # after changing css/ or js/: new ?v= so browsers don't mix old and new files
```

It's a static site (no build step), so it can be hosted as-is on GitHub Pages. To try sale reports locally: `npx wrangler dev`
(with a `SALES` KV binding in `wrangler.jsonc`).

## License

© 2026 Liad Kaufman. All rights reserved. See `LICENSE`.
Not open source: the code may not be copied or reused without written permission.

## Terms, privacy and third-party content

`terms.html` holds the terms of use and privacy notice (linked in the footer). The site loads nothing from
third parties: fonts (Fredoka, Nunito, OFL) are in `assets/fonts/`, icons in `assets/items/`.
Visit counts come from Cloudflare Web Analytics (cookieless).

## Accessibility

Targets WCAG 2.1 AA (basis of Israeli Standard 5568); checked with axe-core, 0 violations in light and dark mode.
Skip link, labelled fields, the item search is an ARIA combobox, price and chance are live regions, the item card
canvas has a full text description, AA color contrast, visible keyboard focus. The round button at the bottom left
offers larger text, stop animations, high contrast and underlined links (saved per browser). The accessibility
statement is in `terms.html#accessibility`.

## How it works guide

"❓ How it works" in the header opens a short guide (it also opens on a first visit): four real frames of the site
in `assets/guide/` that play one after another with a caption each. Retake them after big UI changes.
