// "Check it on screen": the seller shares the game window (the browser asks them first), hovers the item,
// and this page reads the item's window with text recognition. Everything runs in this browser:
// the picture is never uploaded. Only the numbers read (stats and slots left) go to FMCheck to compare.
import { api, esc } from "./account.js?v=072793e5";
import { GAME_LABEL, GAME_ORDER } from "./itemcard.js?v=072793e5";

const $ = (id) => document.getElementById(id);
const VENDOR = new URL("../assets/vendor/tesseract/", import.meta.url).href;
const TIME_LIMIT = 3 * 60e3;

// Stat lines in an item window, e.g. "Weapon Att.: +42 (34 +8)" or "STR : +5". Checked in this order.
const LABELS = [
  ["MAD", /magic\s*att(ack)?/], ["PAD", /weapon\s*att(ack)?|^att(ack)?\b/], ["MDD", /magic\s*def(ense)?/], ["PDD", /weapon\s*def(ense)?/],
  ["MHP", /max\s*hp|^hp\b/], ["MMP", /max\s*mp|^mp\b/], ["ACC", /accuracy/], ["EVA", /avoid(ability)?/],
  ["Speed", /speed/], ["Jump", /jump/], ["STR", /^str\b/], ["DEX", /^dex\b/], ["INT", /^int\b/], ["LUK", /^luk\b/],
];
const SLOTS = /(remaining\s*enhancements?|upgrades?\s*available|number\s*of\s*upgrades?|slots?\s*left)/;

// Common recognition slips inside numbers.
const digits = (s) => s.replace(/[oO]/g, "0").replace(/[lI|]/g, "1").replace(/[sS]/g, "5");

export function parseItemWindow(text) {
  const stats = {};
  let left = null;
  for (const raw of text.split(/\n/)) {
    const line = raw.toLowerCase().replace(/^[^a-z]+/, "").replace(/\s+/g, " ").trim();
    if (!line || /\breq\b|required|req\s*lev/.test(line)) continue;
    const slot = SLOTS.exec(line);
    if (slot) {
      const m = /[:;.]?\s*([0-9oOlI|sS]{1,2})\b/.exec(digits(line.slice(slot.index + slot[0].length)));
      if (m && /^\d+$/.test(m[1])) left = +m[1];
      continue;
    }
    for (const [k, re] of LABELS) {
      const m = re.exec(line);
      if (!m) continue;
      const rest = digits(line.slice(m.index + m[0].length));
      const n = /^[\s.:;]*([+-]?)\s*(\d{1,5})/.exec(rest);
      if (n && stats[k] == null) stats[k] = (n[1] === "-" ? -1 : 1) * +n[2];
      break;
    }
  }
  return { stats, left };
}

// Does what was read match the listing? Every stat on the item must be there with the same number.
export const matches = (read, l) => Object.keys(l.stats).length > 0
  && Object.entries(l.stats).every(([k, v]) => read.stats[k] === v) && read.left === l.left;

let ocr = null;
export async function recognizer(status) {
  if (ocr) return ocr;
  status("Loading the reader (about 15 MB, once)…");
  await new Promise((ok, fail) => {
    if (window.Tesseract) return ok();
    const s = document.createElement("script");
    s.src = `${VENDOR}tesseract.min.js`;
    s.onload = ok;
    s.onerror = () => fail(new Error("Couldn't load the reader."));
    document.head.appendChild(s);
  });
  ocr = await window.Tesseract.createWorker("eng", 1, {
    workerPath: `${VENDOR}worker.min.js`, corePath: `${VENDOR}core/`, langPath: `${VENDOR}lang/`, gzip: true,
    workerBlobURL: false,
  });
  return ocr;
}

// A frame made easier to read: the region the user picked (or all of it), bigger, light text on dark turned to dark on white.
export function prepare(video, box) {
  const vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
  const r = box ? { x: box.x * vw, y: box.y * vh, w: box.w * vw, h: box.h * vh } : { x: 0, y: 0, w: vw, h: vh };
  const scale = Math.min(3, 2600 / Math.max(r.w, r.h));
  const c = document.createElement("canvas");
  c.width = Math.round(r.w * scale);
  c.height = Math.round(r.h * scale);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = Math.max(p[i], p[i + 1], p[i + 2]);
    const v = l > 150 ? 0 : 255; // the item window's text is light on a dark panel
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function startVerify(listing, equip, onDone) {
  const dlg = $("verify");
  const want = GAME_ORDER.filter((k) => listing.stats[k]).map((k) => `${GAME_LABEL[k]} +${listing.stats[k]}`).join(", ");
  $("verifyBody").innerHTML = `
    <ol class="verify-steps">
      <li>Open MapleStory on this computer (Chrome or Edge).</li>
      <li>Press <b>Share the game</b> and pick the MapleStory window. Your browser asks first.</li>
      <li>In the game, hover over <b>${esc(listing.name)}</b> so its item window shows. Keep it there for a few seconds.</li>
    </ol>
    <p class="hint">Looking for: ${esc(want)}, ${listing.left} slot${listing.left === 1 ? "" : "s"} left.
      The picture stays in this browser; only the numbers read are sent to compare.</p>
    <div class="verify-controls">
      <button type="button" id="vStart"><img class="ic" src="assets/ui/vip-mirror.png" alt="" /> Share the game</button>
      <button type="button" class="ghost-btn" id="vStop" hidden>Stop sharing</button>
    </div>
    <p class="hint" id="vPickHint" hidden>Reading is faster if you drag a box around the item window on the picture below.</p>
    <div class="verify-view" id="vView" hidden><video id="vVideo" muted playsinline></video><div id="vBox" class="verify-box" hidden></div></div>
    <p id="vStatus" class="sale-msg" role="status" aria-live="polite"></p>
    <details class="verify-read"><summary>What the reader sees</summary><pre id="vText"></pre></details>`;
  if (!dlg.open) dlg.showModal();

  let stream = null, running = false, box = null, started = 0;
  const status = (t) => { $("vStatus").textContent = t; };
  const stop = () => {
    running = false;
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    $("vStart").hidden = false;
    $("vStop").hidden = true;
  };
  $("verifyClose").onclick = () => dlg.close();
  dlg.addEventListener("close", stop, { once: true });
  $("vStop").onclick = () => { stop(); status("Stopped."); };

  // drag a box around the item window (optional)
  const view = $("vView");
  let drag = null;
  view.onpointerdown = (e) => {
    const r = view.getBoundingClientRect();
    drag = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    view.setPointerCapture(e.pointerId);
  };
  view.onpointermove = (e) => {
    if (!drag) return;
    const r = view.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    const b = { x: Math.min(drag.x, x), y: Math.min(drag.y, y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
    Object.assign($("vBox").style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
    $("vBox").hidden = false;
    box = b.w > 0.03 && b.h > 0.03 ? b : null;
  };
  view.onpointerup = () => { drag = null; };

  $("vStart").onclick = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { status("This browser can't share the screen. Use Chrome or Edge on a computer."); return; }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch { status("Sharing was cancelled."); return; }
    const video = $("vVideo");
    video.srcObject = stream;
    await video.play().catch(() => {});
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (running) { stop(); status("Sharing stopped."); } });
    view.hidden = false;
    $("vPickHint").hidden = false;
    $("vStart").hidden = true;
    $("vStop").hidden = false;
    running = true;
    started = Date.now();
    let worker;
    try { worker = await recognizer(status); } catch (e) { stop(); status(e.message); return; }
    status("Hover over the item in the game…");
    while (running) {
      if (Date.now() - started > TIME_LIMIT) { stop(); status("Couldn't read a match. Try again, and drag a box around the item window."); return; }
      if (!video.videoWidth) { await new Promise((ok) => setTimeout(ok, 300)); continue; }
      const { data } = await worker.recognize(prepare(video, box));
      if (!running) return;
      $("vText").textContent = data.text;
      const read = parseItemWindow(data.text);
      const seen = Object.entries(read.stats).map(([k, v]) => `${GAME_LABEL[k]} ${v}`).join(", ");
      if (matches(read, listing)) {
        status("Found it! Checking…");
        try {
          await api(`/api/listings/${listing.id}/verify`, { method: "POST", body: { stats: read.stats, left: read.left } });
          stop();
          dlg.close();
          onDone();
        } catch (e) { stop(); status(e.message); }
        return;
      }
      status(seen ? `Reading… saw ${seen}${read.left != null ? `, ${read.left} slots left` : ""}. Keep hovering over the item.` : "Hover over the item in the game…");
      await new Promise((ok) => setTimeout(ok, 400));
    }
  };
}
