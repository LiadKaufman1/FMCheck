# FMCheck

Rough price check for scrolled MapleStory Classic items.

Pick an item, set the stats it rolled clean and what such a clean item costs, say how many slots are left,
add the scrolls that passed with today's price for each, and get a ballpark value.

## What it does

Players post their scrolled items (from a screenshot, or by picking the item and its stats) and everyone can browse them
as cards like the in-game item window, with **how rare** each one is (`js/rarity.js`):

- **Natural roll:** for every stat the clean drop rolled above the item's default, the chance a drop rolls it at least
  that high (rolls are default ± 10%, at most ±5, ±10 for DEF/HP/MP), multiplied together.
- **Scrolls:** the chance the scrolls passed like this in the used slots (failed slots spread the likeliest way).
- **Rarity** = natural roll × scrolls, as "1 in N": Common, Uncommon (5+), Rare (50+), Epic (500+), Legendary (5,000+).

A price is optional; posted prices are stored for later.

The earlier version (price estimates from scroll prices, price list, supporters) is kept on the branch
`saved/pricing-model`.

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

### Server

The small server in `src/worker.js` (Cloudflare Worker) serves the site and the community API (`src/community.js`).

### Community

`index.html` (the home page) lists players' scrolled items for sale, with the full picture: stats, slots, scrolls,
odds, the estimate and where to find the seller. Items are put up from the Sell an item page ("Put it in the spotlight").

- Sign-in with Google (Google Identity Services). The Worker checks Google's token itself; it stores only a hash of the
  Google account id and the in-game name the player types. Sessions are random tokens in an HttpOnly cookie.
- Data in Cloudflare D1 (binding `DB`); `src/community.js` creates the tables on first use.
- "Check it on screen" (`js/verify.js`): the seller shares the game window, the page reads the item window with
  [tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0, served from `assets/vendor/tesseract/`), and sends only
  the numbers read; the server compares them with the item.
- Rare items (1 in 50 or rarer, `DISCORD_MIN_ONE_IN`) are posted to Discord through the `DISCORD_WEBHOOK` secret.
- Settings: `GOOGLE_CLIENT_ID` (var), `DISCORD_WEBHOOK` (secret), `ADMIN_IDS` (comma-separated user ids that can remove any item).

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
