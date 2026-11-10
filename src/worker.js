// FMCheck's small server: the static site, plus the community API (src/community.js).
//
//   GET /api/health   { ok, community, googleClientId, supporters, kofiUrl, supporterPrice, boostPrice }
//   /api/auth, /api/me, /api/listings, /api/kofi, /api/admin: see src/community.js

import { community, communityReady, alert } from "./community.js";

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    ...extra,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // the backup addresses (GitHub Pages) read fmcheck.org's API
    "access-control-allow-origin": "*",
    // other sites may only read; changes come from fmcheck.org itself (checked in community.js)
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  },
});

async function api(request, env, ctx, url) {
  if (request.method === "OPTIONS") return json({});
  // nothing the site sends is anywhere near this big
  if (+(request.headers.get("content-length") || 0) > 1_000_000) { alert(request, "too-big"); return json({ error: "Too big." }, 413); }
  if (url.pathname === "/api/health") {
    return json({ ok: true, community: communityReady(env), googleClientId: env.GOOGLE_CLIENT_ID || null,
      supporters: !!env.KOFI_TOKEN && !!env.KOFI_URL, kofiUrl: env.KOFI_URL || null,
      supporterPrice: +(env.SUPPORTER_PRICE || 3), boostPrice: +(env.BOOST_PRICE || 1) });
  }
  if (/^\/api\/(auth|me|listings|messages|kofi|admin|prices)(\/|$)/.test(url.pathname)) return community(request, env, ctx, url, json);
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env, ctx, url); }
      catch (e) { console.error(e); return json({ error: "Something went wrong on our side. Try again." }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
};
