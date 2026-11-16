#!/usr/bin/env node
/**
 * Vyral District auto-poster.
 *
 * Picks the next ad from data/ads.json that hasn't been posted yet, builds a
 * platform-native caption with hashtags, and publishes it to every platform
 * that has credentials configured. Records what was posted in autopost/state.json.
 *
 * Safe by default: nothing is published unless POST_LIVE=true.
 *
 * Env vars (set only the platforms you use):
 *   POST_LIVE=true                 actually publish (otherwise dry run)
 *   IMAGE_BASE_URL                 public URL where assets/ads/*.png are hosted
 *                                  (e.g. https://vyraldistrict.com/assets/ads) — needed for Instagram + photo posts
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET     → X / Twitter
 *   FB_PAGE_ID, FB_PAGE_TOKEN                                    → Facebook Page
 *   IG_USER_ID (+ FB_PAGE_TOKEN)                                 → Instagram Business
 *   AD_ID=vd-003                   force a specific ad
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(root, "autopost", "state.json");
const LIVE = process.env.POST_LIVE === "true";
const GRAPH = "https://graph.facebook.com/v21.0";

const TAG_LIMITS = { instagram: 12, tiktok: 5, x: 2, facebook: 3, linkedin: 3 };

function caption(ad, platform, brand) {
  const tags = ad.hashtags.slice(0, TAG_LIMITS[platform] ?? 5).join(" ");
  if (platform === "x") {
    let text = `${ad.headline} ${ad.body}`;
    const tail = `\n\n${ad.cta} → ${brand.url}\n${tags}`;
    if (text.length + tail.length > 280) text = text.slice(0, 277 - tail.length) + "…";
    return text + tail;
  }
  return `${ad.headline}\n\n${ad.body}\n\n👉 ${ad.cta} — ${brand.url}\n\n${tags}`;
}

/* ---------- X (OAuth 1.0a user context) ---------- */
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method, url) {
  const o = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const params = Object.keys(o).sort().map((k) => `${pct(k)}=${pct(o[k])}`).join("&");
  const base = [method, pct(url), pct(params)].join("&");
  const key = `${pct(process.env.X_API_SECRET)}&${pct(process.env.X_ACCESS_SECRET)}`;
  o.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(o).sort().map((k) => `${pct(k)}="${pct(o[k])}"`).join(", ");
}
async function postX(text) {
  const url = "https://api.twitter.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: oauthHeader("POST", url), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`X ${res.status}: ${JSON.stringify(json)}`);
  return json.data?.id;
}

/* ---------- Facebook Page ---------- */
async function postFacebook(message, imageUrl) {
  const { FB_PAGE_ID: id, FB_PAGE_TOKEN: token } = process.env;
  const endpoint = imageUrl ? `${GRAPH}/${id}/photos` : `${GRAPH}/${id}/feed`;
  const body = new URLSearchParams({ access_token: token, ...(imageUrl ? { url: imageUrl, caption: message } : { message }) });
  const res = await fetch(endpoint, { method: "POST", body });
  const json = await res.json();
  if (!res.ok) throw new Error(`Facebook ${res.status}: ${JSON.stringify(json)}`);
  return json.post_id || json.id;
}

/* ---------- Instagram (Content Publishing API) ---------- */
async function postInstagram(captionText, imageUrl) {
  const { IG_USER_ID: id, FB_PAGE_TOKEN: token } = process.env;
  if (!imageUrl) throw new Error("Instagram needs IMAGE_BASE_URL (a public URL for the ad image).");
  const c = await fetch(`${GRAPH}/${id}/media`, { method: "POST", body: new URLSearchParams({ image_url: imageUrl, caption: captionText, access_token: token }) });
  const cj = await c.json();
  if (!c.ok) throw new Error(`Instagram container ${c.status}: ${JSON.stringify(cj)}`);
  const p = await fetch(`${GRAPH}/${id}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: cj.id, access_token: token }) });
  const pj = await p.json();
  if (!p.ok) throw new Error(`Instagram publish ${p.status}: ${JSON.stringify(pj)}`);
  return pj.id;
}

const PLATFORMS = {
  x:         { enabled: () => ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].every((k) => process.env[k]), post: (cap) => postX(cap) },
  facebook:  { enabled: () => process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN, post: (cap, img) => postFacebook(cap, img) },
  instagram: { enabled: () => process.env.IG_USER_ID && process.env.FB_PAGE_TOKEN, post: (cap, img) => postInstagram(cap, img) },
};

async function main() {
  const { brand, ads } = JSON.parse(await readFile(path.join(root, "data", "ads.json"), "utf8"));
  let state = { posted: [] };
  try { state = JSON.parse(await readFile(STATE, "utf8")); } catch {}

  const postedIds = new Set(state.posted.map((p) => p.id));
  let ad = process.env.AD_ID ? ads.find((a) => a.id === process.env.AD_ID) : ads.find((a) => !postedIds.has(a.id));
  if (!ad) {
    // Every ad has run once: start a new rotation with the least-recently-posted ad.
    ad = ads.find((a) => a.id === state.posted[0]?.id) || ads[0];
    state.posted = state.posted.filter((p) => p.id !== ad.id);
  }

  const imageUrl = process.env.IMAGE_BASE_URL ? `${process.env.IMAGE_BASE_URL.replace(/\/$/, "")}/${ad.id}.png` : null;
  const active = Object.entries(PLATFORMS).filter(([, p]) => p.enabled());

  console.log(`\n${LIVE ? "🔴 LIVE" : "🟡 DRY RUN"} — ad ${ad.id}: "${ad.headline}"`);
  console.log(`Platforms with credentials: ${active.map(([n]) => n).join(", ") || "none"}`);

  const results = {};
  for (const name of Object.keys(PLATFORMS)) {
    const cap = caption(ad, name, brand);
    const p = PLATFORMS[name];
    if (!LIVE || !p.enabled()) {
      console.log(`\n--- ${name}${p.enabled() ? "" : " (no credentials, skipped)"} ---\n${cap}`);
      continue;
    }
    try {
      results[name] = await p.post(cap, imageUrl);
      console.log(`✅ ${name}: posted (${results[name]})`);
    } catch (err) {
      results[name] = { error: err.message };
      console.error(`❌ ${name}: ${err.message}`);
    }
  }
  console.log(`\n🎙️ Voiceover script: ${ad.voiceover}`);

  const succeeded = Object.values(results).some((r) => r && !r.error);
  if (LIVE && succeeded) {
    state.posted.push({ id: ad.id, at: new Date().toISOString(), results });
    await writeFile(STATE, JSON.stringify(state, null, 2) + "\n");
  }
  if (LIVE && active.length && !succeeded) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
