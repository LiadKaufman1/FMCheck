# FMCheck

Rough price check for scrolled MapleStory Classic items.

Pick an item, set the stats it rolled clean and what such a clean item costs, say how many slots are left,
add the scrolls that passed with today's price for each, and get a ballpark value.

## How the estimate works

A buyer won't pay more than it would cost to make an item at least this good themselves, the cheapest way,
so the estimate is that cost plus what the open slots are worth. The page shows the exact formulas under
"How is this worked out?"; the code is `cheapestRoute` and `openSlotValue` in `js/calc.js`.

- **Cheapest way to make one (M):** reach at least the same stat points within the same used slots, using the
  scrolls the user entered. The maker picks the best scroll each step, stops at the goal, and
  drops an item that can't reach it (or that a Chaos scroll destroyed) and starts over with a new clean item.
  Solved as an expected-cost recursion with M on both sides, repeated until it settles.
- **Open slots:** per slot = best scroll's (chance × gain × mesos per stat point − price − chance of losing the
  item × M), never below 0; mesos per stat point = (M − clean price) ÷ points gained.
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

## Run locally

```
npm start          # serves on http://localhost:8000
npm test           # unit tests for the math
npm run data       # rebuild data/*.json from the latest OSMS dataset
python3 scripts/fetch_icons.py   # copy any new item/scroll icons into assets/items/
python3 scripts/stamp.py   # after changing css/ or js/: new ?v= so browsers don't mix old and new files
```

It's a static site (no build step), so it can be hosted as-is on GitHub Pages, Netlify or Cloudflare Pages.

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

## Price my finished item

The "Price my finished item" tab is a box that looks like the game's item tooltip: type the name, the (+N),
each stat as the game shows it ("+total" and the number after + in brackets) and Remaining Enhancements,
or fill it from a screenshot. `inferScrolls` in `js/calc.js` finds the scroll combinations whose gains add up
exactly, ranked by success chance × how common the tier is; the tab then asks only for today's prices and shows
the estimate and card (it fills the same calculator underneath). Screenshots are read in the browser by
`js/reader.js` (Tesseract.js, loaded on first use; the image is never uploaded).
