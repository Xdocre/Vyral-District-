#!/usr/bin/env node
/**
 * Renders Vyral District video ads to MP4 (H.264 + AAC) in every format.
 *   1. python3 videos/audio.py ...   (voiceover + music → videos/build/<id>/)
 *   2. node videos/render.mjs [--only pv-01] [--format 9x16] [--preview]
 * Output: videos/out/<id>-<format>.mp4 and a poster JPG per video.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const ONLY = arg("--only"), FORMAT = arg("--format"), PREVIEW = process.argv.includes("--preview");
const ENGINE = process.argv.includes("--2d") ? "engine.html" : "engine3d.html";
const CANVAS = ENGINE === "engine.html" ? "c" : "out";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mjs": "text/javascript" };
const server = http.createServer(async (req, res) => {
  try {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root)) throw 0;
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const spec = JSON.parse(await readFile(path.join(root, "data", "videos.json"), "utf8"));
const { brand } = JSON.parse(await readFile(path.join(root, "data", "ads.json"), "utf8"));
const outDir = path.join(root, "videos", "out");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const video of spec.videos) {
  if (ONLY && video.id !== ONLY) continue;
  const tl = JSON.parse(await readFile(path.join(root, "videos", "build", video.id, "timeline.json"), "utf8"));
  for (const [fname, format] of Object.entries(spec.formats)) {
    if (FORMAT && fname !== FORMAT) continue;
    if (video.formats && !video.formats.includes(fname)) continue;
    const page = await browser.newPage({ viewport: { width: format.w, height: format.h }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${port}/videos/${ENGINE}`);
    await page.waitForFunction(() => typeof window.setup === "function");
    await page.evaluate((cfg) => window.setup(cfg), { format, timeline: tl, video, brand });

    if (PREVIEW) {
      for (const sc of tl.scenes) {
        const t = Math.min(sc.end - 0.3, sc.voEnd);
        const b64 = await page.evaluate(([t, CANVAS_ID]) => { window.drawFrame(t); return document.getElementById(CANVAS_ID).toDataURL("image/jpeg", 0.85).split(",")[1]; }, [t, CANVAS]);
        await writeFile(path.join(outDir, `preview-${video.id}-${fname}-${sc.kind}-${t.toFixed(1)}.jpg`), Buffer.from(b64, "base64"));
      }
      await page.close();
      continue;
    }

    const file = path.join(outDir, `${video.id}-${fname}.mp4`);
    const ff = spawn("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(spec.fps), "-c:v", "mjpeg", "-i", "-",
      "-i", path.join(root, "videos", "build", video.id, "audio.wav"),
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
      "-movflags", "+faststart", "-shortest", file,
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const frames = Math.ceil(tl.duration * spec.fps);
    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      const b64 = await page.evaluate(([t, CANVAS_ID]) => { window.drawFrame(t); return document.getElementById(CANVAS_ID).toDataURL("image/jpeg", 0.93).split(",")[1]; }, [f / spec.fps, CANVAS]);
      if (f === 60) console.log(`  ${video.id}-${fname}: ${((Date.now() - t0) / 60).toFixed(0)} ms/frame`);
      if (!ff.stdin.write(Buffer.from(b64, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error("ffmpeg " + c)) : r())));
    // poster frame (CTA end card) for thumbnails / website
    const poster = await page.evaluate(([t, CANVAS_ID]) => { window.drawFrame(t); return document.getElementById(CANVAS_ID).toDataURL("image/jpeg", 0.85).split(",")[1]; }, [tl.duration - 0.2, CANVAS]);
    await writeFile(path.join(outDir, `${video.id}-${fname}.jpg`), Buffer.from(poster, "base64"));
    console.log(`✓ ${video.id}-${fname}.mp4  ${frames} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    await page.close();
  }
}
await browser.close();
server.close();
