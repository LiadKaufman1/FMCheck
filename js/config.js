// Where item and scroll stats come from (open API, allows browser requests).
export const ITEM_API = "https://maplestory.io/api/GMS/83";

// Price list the page reads. data/prices.json is filled from prices.html (the admin page).
//
// meso.watch and meowdb.com both block automated requests, so the page can't read their prices directly.
// If either site offers an API or export (ask on their Discord), point this at it, or at a small
// proxy that returns this shape:
//   { "updated": "2026-11-05T08:00:00Z", "prices": { "2043001": 1500000, "1302020": 300000 } }
// keys are item ids, values are typical sale prices in mesos.
export const PRICE_FEED_URL = "data/prices.json";

// Where each price field's "check" link goes.
export const priceLink = (id) => `https://meso.watch/?item=${id}`;
