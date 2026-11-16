#!/usr/bin/env node
/**
 * Vyral District → TikTok auto-poster (TikTok Content Posting API, Direct Post).
 *
 * Each run posts the next vertical video that hasn't been posted yet, with a
 * TikTok-native caption and hashtags. It never re-posts a video (TikTok
 * suppresses duplicates) unless ALLOW_REPEATS=true.
 *
 * Safe by default: nothing is published unless POST_LIVE=true.
 *
 * Env:
 *   POST_LIVE=true
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET   from your app at developers.tiktok.com
 *   TIKTOK_REFRESH_TOKEN                      from a one-time login (see autopost/tiktok-auth.mjs)
 *   TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE         (unaudited apps may only post SELF_ONLY)
 *   VIDEO_ID=pv-02                            force a specific video
 *   ALLOW_REPEATS=true                        restart the rotation when everything has been posted
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(root, "autopost", "tiktok-state.json");
const API = "https://open.tiktokapis.com/v2";
const LIVE = process.env.POST_LIVE === "true";

export function tiktokCaption(video, brand) {
  // Hook first (it's what shows in the feed), then CTA, then 4–5 hashtags.
  const hook = (video.scenes[0].text || video.scenes[0].a || video.scenes[0].vo).replace(/\*/g, "");
  const ctaScene = video.scenes.find((s) => s.kind === "cta");
  const tags = [...new Set([...video.hashtags.filter((t) => !/instagram|meta|facebook/i.test(t)), "#fyp", "#SocialMediaTips"])].slice(0, 6).join(" ");
  return `${hook} ${ctaScene ? ctaScene.cta + " 👉 link in bio" : ""}\n\n${tags}`.slice(0, 2200);
}

async function api(pathname, token, body) {
  const res = await fetch(API + pathname, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!res.ok || (json.error && json.error.code !== "ok")) throw new Error(`${pathname} ${res.status}: ${JSON.stringify(json.error || json)}`);
  return json.data;
}

async function accessToken() {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: process.env.TIKTOK_REFRESH_TOKEN,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`TikTok token refresh failed: ${JSON.stringify(json)}`);
  if (json.refresh_token && json.refresh_token !== process.env.TIKTOK_REFRESH_TOKEN) {
    console.warn("⚠️ TikTok issued a new refresh token. Update the TIKTOK_REFRESH_TOKEN secret before the old one expires.");
  }
  return json.access_token;
}

async function publish(token, file, caption) {
  const creator = await api("/post/publish/creator_info/query/", token);
  const wanted = process.env.TIKTOK_PRIVACY || "PUBLIC_TO_EVERYONE";
  const options = creator.privacy_level_options || [];
  const privacy = options.includes(wanted) ? wanted : options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
  if (privacy !== wanted) console.warn(`⚠️ ${wanted} isn't allowed for this app yet; posting as ${privacy}. Public posting needs TikTok's app audit.`);

  const size = (await stat(file)).size;
  const init = await api("/post/publish/video/init/", token, {
    post_info: {
      title: caption,
      privacy_level: privacy,
      disable_comment: !!creator.comment_disabled,
      disable_duet: !!creator.duet_disabled,
      disable_stitch: !!creator.stitch_disabled,
      video_cover_timestamp_ms: 1200,
      brand_organic_toggle: true, // promoting our own business: TikTok requires this disclosure
    },
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
  });

  const up = await fetch(init.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: await readFile(file),
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await api("/post/publish/status/fetch/", token, { publish_id: init.publish_id });
    if (st.status === "PUBLISH_COMPLETE") return { publish_id: init.publish_id, privacy, post_id: st.publicaly_available_post_id?.[0] };
    if (st.status === "FAILED") throw new Error(`publish failed: ${st.fail_reason}`);
  }
  return { publish_id: init.publish_id, privacy, status: "still processing" };
}

async function main() {
  const spec = JSON.parse(await readFile(path.join(root, "data", "videos.json"), "utf8"));
  const { brand } = JSON.parse(await readFile(path.join(root, "data", "ads.json"), "utf8"));
  let state = { posted: [] };
  try { state = JSON.parse(await readFile(STATE, "utf8")); } catch {}

  const ready = [];
  for (const v of spec.videos) {
    try { await stat(path.join(root, "videos", "out", `${v.id}-9x16.mp4`)); ready.push(v); } catch {}
  }
  // Alternate value tips (og-*) with paid-growth pitches (pv-*): TikTok rewards
  // useful content, and a feed of nonstop pitches looks like an ad account.
  const og = ready.filter((v) => v.id.startsWith("og-")), pv = ready.filter((v) => !v.id.startsWith("og-"));
  ready.length = 0;
  // Pattern: tip, tip, pitch, tip, tip, pitch, ...
  while (og.length || pv.length) {
    for (let k = 0; k < 2 && og.length; k++) ready.push(og.shift());
    if (pv.length) ready.push(pv.shift());
  }
  const done = new Set(state.posted.map((p) => p.id));
  let video = process.env.VIDEO_ID ? ready.find((v) => v.id === process.env.VIDEO_ID) : ready.find((v) => !done.has(v.id));
  if (!video) {
    if (process.env.ALLOW_REPEATS !== "true") {
      console.log(`🛑 All ${ready.length} TikTok videos have been posted. Add new videos (see README) or set ALLOW_REPEATS=true.`);
      return;
    }
    video = ready.find((v) => v.id === state.posted[0]?.id) || ready[0];
    state.posted = state.posted.filter((p) => p.id !== video.id);
  }

  const file = path.join(root, "videos", "out", `${video.id}-9x16.mp4`);
  const caption = tiktokCaption(video, brand);
  console.log(`${LIVE ? "🔴 LIVE" : "🟡 DRY RUN"} — TikTok ${video.id} "${video.title}" (${ready.length - done.size - 1} left after this)\n${caption}\n`);

  const hasCreds = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"].every((k) => process.env[k]);
  if (!LIVE) return;
  if (!hasCreds) { console.log("No TikTok credentials set; skipping."); return; }

  const result = await publish(await accessToken(), file, caption);
  console.log("✅ TikTok:", result);
  state.posted.push({ id: video.id, at: new Date().toISOString(), ...result });
  await writeFile(STATE, JSON.stringify(state, null, 2) + "\n");
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
