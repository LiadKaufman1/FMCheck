// Talking to FMCheck's server: health, the signed-in player, and Google sign-in.
// fmcheck.org serves the API; the GitHub Pages backup reads from it there (signing in works on fmcheck.org only).
export const API = location.hostname.endsWith("github.io") ? "https://fmcheck.org" : "";
export const canSignIn = () => /^(fmcheck\.org|localhost|127\.0\.0\.1)$/.test(location.hostname);

export async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    credentials: API ? "omit" : "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  // upsell: the limit was hit, and being a supporter would lift it
  if (!r.ok) throw Object.assign(new Error(j.error || "Couldn't reach FMCheck. Try again later."), { status: r.status, upsell: !!j.upsell });
  return j;
}

let healthP = null;
export const health = () => (healthP ||= api("/api/health").catch(() => ({})));

let meP = null;
export const me = (fresh = false) => ((fresh || !meP) ? (meP = api("/api/me").catch(() => ({ user: null, listings: [] }))) : meP);

let gsiP = null;
const loadGsi = () => (gsiP ||= new Promise((ok, fail) => {
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true;
  s.onload = ok;
  s.onerror = () => { gsiP = null; fail(new Error("Couldn't load Google sign-in.")); };
  document.head.appendChild(s);
}));

// Puts a "Sign in with Google" button in `el`; calls onUser(user) once signed in.
export async function googleButton(el, onUser) {
  if (!canSignIn()) {
    el.innerHTML = `<a class="ghost-btn" href="https://fmcheck.org/community.html">Sign in on fmcheck.org</a>`;
    return;
  }
  const h = await health();
  if (!h.googleClientId) { el.innerHTML = `<p class="hint">Signing in isn't set up yet.</p>`; return; }
  try { await loadGsi(); } catch (e) { el.innerHTML = `<p class="hint">${e.message}</p>`; return; }
  google.accounts.id.initialize({
    client_id: h.googleClientId,
    callback: async ({ credential }) => {
      try {
        const j = await api("/api/auth/google", { method: "POST", body: { credential } });
        meP = null;
        onUser(j.user);
      } catch (e) { el.insertAdjacentHTML("beforeend", `<p class="warn">${e.message}</p>`); }
    },
  });
  el.innerHTML = "";
  google.accounts.id.renderButton(el, { theme: "outline", size: "large", shape: "pill", text: "signin_with" });
}

export async function signOut() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  try { google.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
  meP = null;
}

export const validIgn = (s) => /^[A-Za-z0-9]{2,13}$/.test(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
export const place = (l) => [l.channel ? `Ch ${l.channel}` : "", l.room ? `FM${l.room}` : "", l.where ? esc(l.where) : ""].filter(Boolean).join(" · ");
