#!/usr/bin/env node
/**
 * Renders every ad in data/ads.json to a 1080x1080 PNG in assets/ads/ using
 * the same card design as the website. Requires Playwright (npx playwright).
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  try {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root)) throw new Error("bad path");
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const { ads } = JSON.parse(await readFile(path.join(root, "data", "ads.json"), "utf8"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${port}/autopost/card.html`);
for (const ad of ads) {
  await page.evaluate((id) => window.show(id), ad.id);
  await page.waitForTimeout(150);
  await page.locator(".vd-card").screenshot({ path: path.join(root, "assets", "ads", `${ad.id}.png`) });
  console.log("rendered", ad.id);
}
await browser.close();
server.close();
