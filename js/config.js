// Item and scroll data: OSMS Data Explorer (https://osmsdataexplorer.com, CC BY 4.0, by @ohmi),
// built into data/*.json by scripts/build_data.py. Icons are copied into assets/items/ by scripts/fetch_icons.py,
// so the site doesn't load them from osmsdataexplorer.com on every visit.
const pad = (id) => String(id).padStart(8, "0");
export const iconUrl = (id) => `assets/items/${pad(id)}.png`;

// Where each "check price" link goes. Users look prices up there and type them in;
// the site itself reads nothing from meso.watch. meso.watch writes ids as 8 digits (01082000).
// q asks meso.watch to filter its list by name; it may ignore it, so the page also copies the name.
export const priceLink = (id, name = "") =>
  `https://meso.watch/?${new URLSearchParams(name ? { item: pad(id), q: name } : { item: pad(id) })}`;

// Donate button (PayPal), e.g. "https://www.paypal.com/paypalme/yourname". Empty hides the buttons.
export const DONATE_URL = "https://paypal.me/FMCheck";

// Community Discord (invite link that never expires).
export const DISCORD_URL = "https://discord.gg/hWYs9vxhRv";
