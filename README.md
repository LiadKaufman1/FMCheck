# FMCheck

Rough price check for scrolled MapleStory Classic items.

Pick an item, set the stats it rolled clean and what such a clean item costs, say how many slots are left,
add the scrolls that passed with today's price for each, and get a ballpark value.

## How the estimate works

A buyer won't pay more than it would cost to make an item at least this good themselves, the cheapest way,
so the estimate is that cost plus what the open slots are worth. The page shows the exact formulas under
"How is this worked out?"; the code is `cheapestRoute` and `openSlotValue` in `js/calc.js`.

- **Cheapest way to make one (M):** reach at least the same stat points within the same used slots, using any
  tier of the same scroll that has a price. The maker picks the best scroll each step, stops at the goal, and
  drops an item that can't reach it (or that a Chaos scroll destroyed) and starts over with a new clean item.
  Solved as an expected-cost recursion with M on both sides, repeated until it settles.
- **Open slots:** per slot = best scroll's (chance × gain × mesos per stat point − price − chance of losing the
  item × M), never below 0; mesos per stat point = (M − clean price) ÷ points gained.
- **Estimate** = M + open slots, worked out with all "from" prices and all "to" prices for the range.

Assumes a failed scroll uses up its slot (what community simulators assume; the game data doesn't say).

## Data

Item and scroll data comes from the [OSMS Data Explorer](https://osmsdataexplorer.com) public dataset
for MapleStory Classic World (by @ohmi, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)),
extracted from the game client. `scripts/build_data.py` turns it into:

- `data/equips.json`: every equip with upgrade slots, with its base stats
- `data/scrolls.json`: every scroll, with success rate, destroy rate (Chaos scrolls) and stat gains
- `data/source.json`: the client build and date of the data

Icons load from osmsdataexplorer.com. Item ids and names match meso.watch, so "check price" opens the right item there.

> Data from OSMS Data Explorer (https://osmsdataexplorer.com), CC BY 4.0. Game content © Nexon.

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
npm run data       # rebuild data/*.json from the latest OSMS dataset
python3 scripts/stamp.py   # after changing css/ or js/: new ?v= so browsers don't mix old and new files
```

It's a static site (no build step), so it can be hosted as-is on GitHub Pages, Netlify or Cloudflare Pages.

## License

© 2026 Liad Kaufman. All rights reserved. See `LICENSE`.
Not open source: the code may not be copied or reused without written permission.
