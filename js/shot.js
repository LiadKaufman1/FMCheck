// Reading a picture of an in-game item window (a screenshot, or a phone photo of the screen) in this browser.
// The picture is never uploaded: it's read here with text recognition (js/verify.js loads the reader),
// then js/itemread.js works out the item, its stats, slots left and the likeliest scrolls.
import { recognizer } from "./verify.js?v=c25d3b4c";
import { parseWindow, findItem, guessScrolls } from "./itemread.js?v=c25d3b4c";

// The picture drawn at a size the reader likes, as three versions: as it is (screenshots), white text only
// (the stats, for photos of a screen) and yellow text only (the item's name).
async function versions(file) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width > 1100 ? 1000 / bmp.width : bmp.width < 600 ? 2 : 1;
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const draw = (blur) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (blur) g.filter = "blur(0.7px)";
    g.drawImage(bmp, 0, 0, w, h);
    return c;
  };
  const only = (test) => {
    const c = draw(true), g = c.getContext("2d");
    const img = g.getImageData(0, 0, w, h), p = img.data;
    for (let i = 0; i < p.length; i += 4) {
      const v = test(p[i], p[i + 1], p[i + 2]) ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  return [
    only((r, g, b) => r > 170 && g > 130 && b < 110 && r - b > 90), // yellow: the name
    draw(false),                                                    // as it is
    only((r, g, b) => Math.min(r, g, b) > 170),                     // white: the stats
  ];
}

// status(text): progress for the page. Returns { text, read, items, guess } or throws.
export async function readItemPicture(file, equips, scrolls, status = () => {}) {
  const worker = await recognizer(status);
  const pics = await versions(file);
  let text = "";
  for (const [i, pic] of pics.entries()) {
    status(`Reading the picture (${i + 1}/${pics.length})…`);
    text += (await worker.recognize(pic)).data.text + "\n";
  }
  const read = parseWindow(text);
  const items = findItem(read, equips);
  const guess = items.length ? guessScrolls(items[0].e, read, scrolls) : null;
  return { text, read, items, guess };
}
