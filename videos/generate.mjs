#!/usr/bin/env node
/**
 * Daily content generator: asks Claude for fresh Vyral District video scripts
 * and appends them to data/videos.json. Rendering + posting happen later in
 * the TikTok workflow (videos/render.mjs → autopost/tiktok.mjs).
 *
 *   ANTHROPIC_API_KEY=... node videos/generate.mjs [--count 3] [--dry-run]
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const COUNT = Number(arg("--count", 3));
const DRY = process.argv.includes("--dry-run");

// One flat "beat" shape keeps the schema simple; unused fields are left empty.
const Beat = z.object({
  kind: z.enum(["line", "list", "counter", "chart", "split"]),
  vo: z.string().describe("Voiceover for this beat, max 18 words, spoken naturally (spell numbers as words)."),
  text: z.string().describe("line: on-screen text, max 10 words. Wrap 1-2 key words in *asterisks* to highlight. Empty for other kinds."),
  title: z.string().describe("list/chart: short heading, max 4 words. Empty otherwise."),
  items: z.array(z.string()).describe("list: exactly 3 items, max 4 words each, no numbering or symbols. Empty otherwise."),
  bars: z.array(z.string()).describe("chart: 3-4 short labels (max 2 words) showing growth left to right. Empty otherwise."),
  a: z.string().describe("split: first half statement, max 5 words. Empty otherwise."),
  b: z.string().describe("split: contrasting second half, max 5 words. Empty otherwise."),
  prefix: z.string().describe("counter: e.g. '$' or ''. Empty otherwise."),
  from: z.number().int().describe("counter: start value (small integer). 0 otherwise."),
  to: z.number().int().describe("counter: end value (small integer, at most 6 above from). 0 otherwise."),
  suffix: z.string().describe("counter: e.g. '/day' or ''. Empty otherwise."),
  label: z.string().describe("counter: caption under the number, max 6 words. Empty otherwise."),
});
const Video = z.object({
  type: z.enum(["tip", "pitch"]),
  title: z.string().describe("Short internal title, max 6 words."),
  hook: z.object({ text: z.string().describe("Scroll-stopping on-screen hook, max 7 words, 1-2 *highlighted* words."), vo: z.string() }),
  beats: z.array(Beat).describe("2 to 3 beats that deliver the value."),
  cta: z.object({ cta: z.string().describe("Button text, max 5 words."), vo: z.string().describe("Spoken CTA ending with 'Vyral District' or 'Join the District'.") }),
  hashtags: z.array(z.string()).describe("5 hashtags, first two are #VyralDistrict #GoVyral, the rest niche + broad."),
});
const Batch = z.object({ videos: z.array(Video) });

const SYSTEM = `You write short vertical TikTok videos for Vyral District, a brand that promotes social media growth (organic content strategy) and paid growth (TikTok/Meta/X ads).

Brand voice, "The Hype Architect": bold, confident, street-smart, zero fluff, results-first. Hook in the first 5 words. Talk to one creator ("you"). Numbers beat adjectives. One clear CTA.

Rules:
- Every video teaches or reveals one specific, actionable idea in about 15 seconds of voiceover total.
- Never promise guaranteed virality, guaranteed results, or specific follower numbers. Never mention buying followers.
- On-screen text must be plain ASCII (no emoji, no curly quotes, no arrows or bullets) because it is rendered in a 3D font.
- Voiceover must read naturally aloud; spell out numbers ("three", "ten K").
- Don't repeat ideas from the existing titles you are given; find new angles (hooks, retention, posting cadence, analytics, profile optimization, collabs, trends, Spark Ads, retargeting, creative testing, budgets, UGC, captions, comments, live streams, Twitch/YouTube cross-posting, etc.).`;

async function main() {
  const file = path.join(root, "data", "videos.json");
  const spec = JSON.parse(await readFile(file, "utf8"));
  const existing = spec.videos.map((v) => v.title).slice(-80);

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("No ANTHROPIC_API_KEY set: skipping daily script generation. Existing queue will keep posting.");
    return;
  }
  const client = new Anthropic();
  const tips = Math.max(1, COUNT - Math.floor(COUNT / 3));
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if a request is declined, the API retries it on a fallback model
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Write ${COUNT} new videos: ${tips} of type "tip" (pure value for creators and small businesses) and ${COUNT - tips} of type "pitch" (why paid growth / Vyral District's services work). Put them in the order tip, tip, pitch.\n\nExisting titles to avoid repeating:\n${existing.map((t) => "- " + t).join("\n")}`,
    }],
    output_config: { format: betaZodOutputFormat(Batch) },
  });
  if (response.stop_reason === "refusal") throw new Error(`Generation declined: ${JSON.stringify(response.stop_details)}`);
  const out = response.parsed_output;
  if (!out?.videos?.length) throw new Error(`No videos parsed (stop_reason ${response.stop_reason}).`);

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const socials = [
    ["Followers going *up.*", "Instagram. TikTok. Twitch. Facebook. X. Watch every platform grow."],
    ["Every platform. *Growing.*", "More followers on Instagram, TikTok, Twitch, Facebook, and X."],
    ["Watch the numbers *climb.*", "Every platform. Every follower count. Going up."],
  ];
  const plats = [["Instagram", 1200, 48600], ["TikTok", 860, 125000], ["Twitch", 240, 12400], ["Facebook", 3100, 27900], ["X", 410, 18200]];
  const added = out.videos.slice(0, COUNT).map((v, i) => {
    const beats = v.beats.slice(0, 3).map((b) => {
      if (b.kind === "line") return { kind: "line", text: b.text, vo: b.vo };
      if (b.kind === "list") return { kind: "list", title: b.title, items: b.items.slice(0, 3), vo: b.vo };
      if (b.kind === "chart") return { kind: "chart", title: b.title, bars: b.bars.slice(0, 4), vo: b.vo };
      if (b.kind === "split") return { kind: "split", a: b.a, b: b.b, vo: b.vo };
      const from = Math.max(0, b.from), to = Math.min(Math.max(from + 1, b.to), from + 6);
      return { kind: "counter", prefix: b.prefix, from, to, suffix: b.suffix, label: b.label, vo: b.vo };
    }).filter((b) => (b.kind !== "list" || b.items.length) && (b.kind !== "chart" || b.bars.length >= 2));
    const [st, svo] = socials[(Number(day) + i) % socials.length];
    const tags = [...new Set(["#VyralDistrict", "#GoVyral", ...v.hashtags.map((t) => (t.startsWith("#") ? t : "#" + t).replace(/\s+/g, ""))])].slice(0, 6);
    return {
      id: `d-${day}-${i + 1}`,
      title: v.title,
      type: v.type,
      theme: "violet",
      formats: ["9x16"],
      hashtags: tags,
      scenes: [
        { kind: "hook", text: v.hook.text, vo: v.hook.vo },
        ...beats,
        { kind: "socials", title: st, platforms: plats.map(([name, from, to]) => ({ name, from, to })), min: 3.8, vo: svo },
        { kind: "cta", cta: v.cta.cta, vo: v.cta.vo },
      ],
    };
  });

  spec.videos = spec.videos.filter((v) => !added.some((a) => a.id === v.id)).concat(added);
  for (const a of added) console.log(`+ ${a.id} [${a.type}] ${a.title}`);
  if (DRY) { console.log(JSON.stringify(added, null, 2)); return; }
  await writeFile(file, JSON.stringify(spec, null, 2) + "\n");
}

main().catch((e) => {
  if (e instanceof Anthropic.APIError) console.error(`Claude API error ${e.status}: ${e.message}`);
  else console.error(e.message);
  process.exit(1);
});
