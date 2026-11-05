// Where item icons come from (open API, allows browser requests).
export const ITEM_API = "https://maplestory.io/api/GMS/83";

// Where each price field's "check" link goes. Users look prices up there and type them in;
// the site itself reads nothing from meso.watch.
export const priceLink = (id) => `https://meso.watch/?item=${id}`;
