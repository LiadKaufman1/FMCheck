// The result card: drawn like an in-game item tooltip, plus FMCheck's numbers.
// It's a <canvas>, so the picture people save or paste is exactly what they see.

const W = 360;          // card width in CSS pixels
const SCALE = 2;        // drawn at 2× for a sharp picture
const PAD = 16;
const JOBS = ["Beginner", "Warrior", "Magician", "Bowman", "Thief"];
const C = {
  bgTop: "#25306b", bgBottom: "#151b44", edge: "#7c89d6", line: "rgba(255,255,255,.18)",
  title: "#ffb83d", text: "#ffffff", muted: "#9aa3d6", dim: "#5d6596",
  jobOn: "#ff8a1f", jobOff: "#4a5285", gain: "#7dffa8", price: "#ffd25a", box: "#f4f4f4",
};
const FONT = '"Nunito", system-ui, sans-serif';
const TITLE_FONT = '"Fredoka", "Nunito", system-ui, sans-serif';

const icons = new Map();
function loadIcon(url, onload) {
  if (icons.has(url)) return icons.get(url);
  const img = new Image();
  img.crossOrigin = "anonymous"; // the icon site allows it, so the canvas can still be saved
  img.onload = onload;
  img.src = url;
  icons.set(url, img);
  return img;
}

// d: { name, upgrades, icon, level, req: [STR, DEX, INT, LUK], jobs, type, stats: [{ label, total, base, gain }],
//      left, price: { lo, hi } | null, priceHint, date, chance, oneIn, scrolls: [{ n, name }], footer }
export function drawCard(canvas, d, fmt) {
  const img = loadIcon(d.icon, () => drawCard(canvas, d, fmt));
  const ctx = canvas.getContext("2d");
  const H = layout(ctx, d, fmt, null, false); // measure first
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  canvas.style.aspectRatio = `${W} / ${H}`;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  layout(ctx, d, fmt, img, true);
}

function layout(ctx, d, fmt, img, draw) {
  let y = 0;
  const text = (s, x, yy, { size = 13, weight = 700, color = C.text, align = "left", font = FONT } = {}) => {
    ctx.font = `${weight} ${size}px ${font}`;
    if (draw) { ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic"; ctx.fillText(s, x, yy); }
    return ctx.measureText(s).width;
  };
  const hr = (yy) => { if (draw) { ctx.fillStyle = C.line; ctx.fillRect(PAD, yy, W - PAD * 2, 1); } };
  const H = d._h || 0;

  if (draw) { // background panel
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bgTop); g.addColorStop(1, C.bgBottom);
    round(ctx, 1, 1, W - 2, H - 2, 12); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.edge; ctx.stroke();
  }

  // title
  y += 32;
  text(`${d.name}${d.upgrades ? ` (+${d.upgrades})` : ""}`, W / 2, y, { size: 19, color: C.title, align: "center", font: TITLE_FONT, weight: 600 });

  // icon box + requirements
  y += 14;
  const box = 92;
  if (draw) {
    ctx.fillStyle = C.box; round(ctx, PAD, y, box, box, 6); ctx.fill();
    if (img && img.complete && img.naturalWidth) {
      const s = Math.min(Math.floor((box - 14) / Math.max(img.naturalWidth, img.naturalHeight)), 3) || 1;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, PAD + (box - img.naturalWidth * s) / 2, y + (box - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    }
  }
  const reqs = [["REQ LEV", d.level], ["REQ STR", d.req[0]], ["REQ DEX", d.req[1]], ["REQ INT", d.req[2]], ["REQ LUK", d.req[3]]];
  reqs.forEach(([k, v], i) => {
    const yy = y + 15 + i * 18;
    const on = v > 0;
    text(k, PAD + box + 20, yy, { size: 13, color: on ? C.text : C.dim, weight: 800 });
    text(`:  ${v}`, PAD + box + 92, yy, { size: 13, color: on ? C.text : C.dim, weight: 800 });
  });
  y += box + 14;

  // job tags
  let x = PAD;
  ctx.font = `800 10.5px ${FONT}`;
  for (const j of JOBS) {
    const on = !d.jobs || d.jobs.includes(j);
    const w = ctx.measureText(j.toUpperCase()).width + 10;
    if (draw) {
      ctx.fillStyle = "rgba(0,0,0,.25)"; round(ctx, x, y, w, 18, 3); ctx.fill();
      ctx.strokeStyle = on ? C.jobOn : C.jobOff; ctx.lineWidth = 1; ctx.stroke();
    }
    text(j.toUpperCase(), x + 5, y + 13, { size: 10.5, weight: 800, color: on ? C.jobOn : C.jobOff });
    x += w + 5;
  }
  y += 30;
  hr(y); y += 22;

  // stats, like "• Weapon Att.: +42 (34 +8)"
  const line = (label, value, extra) => {
    text("•", PAD, y, { color: C.title, size: 13 });
    const w1 = text(`${label}: `, PAD + 12, y, { size: 14, weight: 700, color: C.muted });
    const w2 = text(value, PAD + 12 + w1, y, { size: 14, weight: 800 });
    if (extra) text(extra, PAD + 12 + w1 + w2 + 6, y, { size: 13, weight: 800, color: C.gain });
    y += 22;
  };
  line("Type", d.type);
  for (const s of d.stats) line(s.label, `+${s.total}`, s.gain ? `(${s.base} +${s.gain})` : "");
  line("Remaining Enhancements", String(d.left));

  // Rarity: the tier in its colour, "1 in N", and what it's made of. Then the price, if it's for sale.
  y += 2; hr(y); y += 24;
  const r = d.rarity;
  text("RARITY", PAD, y, { size: 11, weight: 800, color: C.muted });
  y += 30;
  const tw = text(r.tier.name.toUpperCase(), PAD, y, { size: 24, weight: 700, color: r.tier.color, font: TITLE_FONT });
  text(fmt.oneIn(r.oneIn), PAD + tw + 10, y, { size: 17, weight: 800, color: C.text });
  y += 24;
  const part = (label, p) => {
    text(label, PAD, y, { size: 12.5, weight: 700, color: C.muted });
    text(p >= 0.995 ? "any" : fmt.oneIn(1 / p), W - PAD, y, { size: 12.5, weight: 800, color: C.text, align: "right" });
    y += 18;
  };
  part("Natural roll", r.roll);
  part(r.failed ? `Scrolls (${r.failed} failed)` : "Scrolls", r.scrolls);
  if (d.scrolls.length) {
    y += 2;
    for (const s of d.scrolls) {
      text(`${s.n}× ${s.name}`, PAD, y, { size: 12, weight: 700, color: C.dim });
      y += 17;
    }
  }
  if (d.askPrice) {
    y += 8;
    const pw = text("FOR SALE", PAD, y + 2, { size: 11, weight: 800, color: C.muted });
    text(fmt.mesos(d.askPrice), PAD + pw + 10, y + 4, { size: 20, weight: 700, color: C.price, font: TITLE_FONT });
    if (d.seller) text(d.seller, W - PAD, y + 3, { size: 13, weight: 800, color: C.text, align: "right" });
    y += 22;
  } else if (d.seller) {
    y += 6;
    text(`by ${d.seller}`, W - PAD, y, { size: 12.5, weight: 800, color: C.muted, align: "right" });
    y += 14;
  }

  // footer
  y += 6; hr(y); y += 19;
  text("FM", PAD, y, { size: 14, weight: 700, color: C.text, font: TITLE_FONT });
  text("Check", PAD + 21, y, { size: 14, weight: 700, color: C.title, font: TITLE_FONT });
  text(d.footer, W - PAD, y, { size: 10.5, weight: 700, color: C.dim, align: "right" });
  y += 14;

  d._h = y;
  return y;
}

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const cardBlob = (canvas) => new Promise((ok) => canvas.toBlob(ok, "image/png"));
