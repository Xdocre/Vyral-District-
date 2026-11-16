#!/usr/bin/env node
/**
 * One-time TikTok login to get a refresh token for the auto-poster.
 *
 *   1. TIKTOK_CLIENT_KEY=... TIKTOK_REDIRECT_URI=https://<your-site>/tiktok-callback.html node autopost/tiktok-auth.mjs
 *      → open the printed link, log in as your Vyral District TikTok account, approve.
 *   2. The callback page shows a code. Run:
 *      TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... TIKTOK_REDIRECT_URI=... node autopost/tiktok-auth.mjs <code>
 *      → prints the refresh token. Save it as the TIKTOK_REFRESH_TOKEN GitHub secret.
 */
const { TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret, TIKTOK_REDIRECT_URI: redirect } = process.env;
const code = process.argv[2];
if (!key || !redirect) { console.error("Set TIKTOK_CLIENT_KEY and TIKTOK_REDIRECT_URI."); process.exit(1); }

if (!code) {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.search = new URLSearchParams({ client_key: key, scope: "user.info.basic,video.publish,video.upload", response_type: "code", redirect_uri: redirect, state: Math.random().toString(36).slice(2) });
  console.log("Open this link and approve:\n\n" + u.toString() + "\n");
} else {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: key, client_secret: secret, code: decodeURIComponent(code), grant_type: "authorization_code", redirect_uri: redirect }),
  });
  const json = await res.json();
  if (!json.refresh_token) { console.error("Failed:", json); process.exit(1); }
  console.log(`✅ Logged in (open_id ${json.open_id}).\nSave this as the TIKTOK_REFRESH_TOKEN secret (valid ${Math.round(json.refresh_expires_in / 86400)} days):\n\n${json.refresh_token}\n`);
}
