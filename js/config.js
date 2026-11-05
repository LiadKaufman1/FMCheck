// Where item icons come from (open API, allows browser requests).
export const ITEM_API = "https://maplestory.io/api/GMS/83";

// Where each price field's "check" link goes. Users look prices up there and type them in;
// the site itself reads nothing from meso.watch.
// meso.watch writes item ids as 8 digits (01082002); q also filters its list by name.
export const priceLink = (id, name = "") => {
  const q = new URLSearchParams({ item: String(id).padStart(8, "0") });
  if (name) q.set("q", name.replace(/\s+\d+%$/, ""));
  return `https://meso.watch/?${q}`;
};
