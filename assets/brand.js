/* Vyral District — shared brand engine: voice, hashtags, ad generator, ad card renderer. */
(function (global) {
  const THEMES = {
    // Monochrome variants of the brand: black + smoke grey
    violet:  { a: "#161616", b: "#000000", ink: "#bdbdbd" },
    magenta: { a: "#262626", b: "#050505", ink: "#e6e6e6" },
    cyan:    { a: "#0a0a0a", b: "#1f1f1f", ink: "#9b9b9b" },
    lime:    { a: "#d4d4d4", b: "#8f8f8f", ink: "#0a0a0a" },
  };

  // How many hashtags each platform should get (keeps posts native to each feed).
  const PLATFORM_TAG_LIMITS = { instagram: 12, tiktok: 5, x: 2, facebook: 3, linkedin: 3 };

  const HASHTAG_BANK = {
    brand:   ["#VyralDistrict", "#GoVyral"],
    organic: ["#SocialMediaGrowth", "#OrganicGrowth", "#ContentStrategy", "#CreatorTips", "#GrowOnInstagram", "#TikTokGrowth", "#ContentCreator", "#ReelsTips", "#ShortFormVideo", "#PersonalBrand"],
    paid:    ["#PaidGrowth", "#PaidAds", "#TikTokAds", "#MetaAds", "#PaidSocial", "#AdStrategy", "#PerformanceMarketing", "#ROAS", "#DigitalMarketing", "#GrowthMarketing"],
    hybrid:  ["#SocialMediaMarketing", "#BrandGrowth", "#ScaleYourBusiness", "#MarketingStrategy", "#BusinessGrowth", "#Entrepreneur"],
  };

  // Brand-voice copy pools. {niche} and {offer} are filled from user input.
  const POOLS = {
    organic: {
      headlines: [
        "Posting daily. Still stuck?",
        "Your {niche} content deserves more eyes.",
        "3 seconds. That's your window.",
        "Consistency beats virality.",
        "Views are high. Follows aren't. Let's fix that.",
      ],
      bodies: [
        "It's not the algorithm. It's the strategy. Vyral District builds {niche} content systems that turn scrollers into followers.",
        "Hooks that stop thumbs. Series that build habits. A profile that converts. That's how accounts in {niche} grow.",
        "One viral post fades in a week. A consistent system compounds for a year. We build yours.",
      ],
    },
    paid: {
      headlines: [
        "$5 a day. Done right.",
        "Stop boosting posts.",
        "Your {niche} brand + real ads = real growth.",
        "Ads that pay for themselves.",
      ],
      bodies: [
        "Paid growth isn't about spending more. It's about spending smart. We build, test and scale {niche} ads that pay for themselves.",
        "Targeting. Testing. Scaling. Real campaigns, not boost buttons. Vyral District runs paid growth for {niche} brands.",
      ],
    },
    hybrid: {
      headlines: [
        "Organic gets you seen. Paid gets you scaled.",
        "0 to 10K is a system, not luck.",
        "One district. Every kind of growth.",
      ],
      bodies: [
        "Most {niche} brands pick one. The ones that win run both. Vyral District runs your content and your ads under one roof.",
        "Content pillars. Posting cadence. Ads that amplify winners. That's the Vyral District system for {niche}.",
      ],
    },
    ctas: {
      organic: ["Get your free growth audit", "Steal our hook playbook", "Join the District", "Start your 30-day plan"],
      paid: ["Launch your first campaign", "Get a real ad plan", "Book a strategy call"],
      hybrid: ["Book a strategy call", "Join the District", "Get your free growth audit"],
    },
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fill = (s, v) => s.replace(/\{niche\}/g, v.niche || "creator").replace(/\{offer\}/g, v.offer || "growth");
  const toTag = (w) => "#" + w.replace(/[^a-z0-9 ]/gi, "").split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

  function buildHashtags(type, niche, extra) {
    const pool = [...(HASHTAG_BANK[type] || []), ...HASHTAG_BANK.hybrid].sort(() => Math.random() - 0.5);
    const custom = [niche ? toTag(niche) : null, niche ? toTag(niche + " growth") : null, ...(extra || [])].filter(Boolean);
    return [...new Set([...HASHTAG_BANK.brand, ...custom, ...pool])].slice(0, 15);
  }

  function hashtagsFor(ad, platform) {
    const n = PLATFORM_TAG_LIMITS[platform] ?? 5;
    return ad.hashtags.slice(0, n);
  }

  function captionFor(ad, platform, brand) {
    const tags = hashtagsFor(ad, platform).join(" ");
    const url = brand && brand.url ? brand.url : "";
    if (platform === "x") {
      // Keep under 280 chars.
      let text = `${ad.headline} ${ad.body}`;
      const tail = `\n\n${ad.cta} → ${url}\n${tags}`;
      if (text.length + tail.length > 280) text = text.slice(0, 277 - tail.length) + "…";
      return text + tail;
    }
    return `${ad.headline}\n\n${ad.body}\n\n👉 ${ad.cta}${url ? " — " + url : ""}\n\n${tags}`;
  }

  function generateAd({ type = "organic", niche = "", offer = "", extraTags = [] } = {}) {
    const p = POOLS[type] || POOLS.organic;
    const v = { niche: niche.trim(), offer: offer.trim() };
    const headline = fill(pick(p.headlines), v);
    const body = fill(pick(p.bodies), v);
    const cta = offer ? fill(offer, v) : pick(POOLS.ctas[type] || POOLS.ctas.organic);
    const themes = Object.keys(THEMES);
    return {
      id: "vd-" + Date.now().toString(36),
      type,
      theme: pick(themes),
      headline,
      body,
      cta,
      voiceover: `${headline} ${body} ${cta}. Vyral District.`,
      hashtags: buildHashtags(type, v.niche, extraTags),
    };
  }

  /* ---------- Voice (Web Speech API) ---------- */
  const Voice = {
    config: { rate: 1.05, pitch: 0.85, preferredVoices: [] },
    selected: null,
    list() { return "speechSynthesis" in global ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : []; },
    pickDefault() {
      const voices = this.list();
      for (const name of this.config.preferredVoices) {
        const v = voices.find((x) => x.name.includes(name));
        if (v) return v;
      }
      return voices[0] || null;
    },
    speak(text, { onend } = {}) {
      if (!("speechSynthesis" in global)) { alert("Voiceover needs a browser with speech support (Chrome, Safari, Edge)."); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = this.selected || this.pickDefault();
      u.rate = this.config.rate;
      u.pitch = this.config.pitch;
      if (onend) u.onend = onend;
      speechSynthesis.speak(u);
    },
    stop() { if ("speechSynthesis" in global) speechSynthesis.cancel(); },
  };

  /* ---------- Ad card (DOM) ---------- */
  function cardHTML(ad, brand) {
    const t = THEMES[ad.theme] || THEMES.violet;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return `
      <div class="vd-card" style="--a:${t.a};--b:${t.b};--ink:${t.ink}">
        <div class="vd-card__glow"></div>
        <div class="vd-card__top"><span class="vd-logo">VYRAL<b>DISTRICT</b></span><span class="vd-pill">${esc(ad.type)}</span></div>
        <h3 class="vd-card__headline">${esc(ad.headline)}</h3>
        <p class="vd-card__body">${esc(ad.body)}</p>
        <div class="vd-card__foot"><div class="vd-card__cta">${esc(ad.cta)} →</div><div class="vd-card__handle">${esc(brand?.handle || "@vyraldistrict")}</div></div>
      </div>`;
  }

  async function loadData(path = "data/ads.json") {
    const res = await fetch(path);
    const data = await res.json();
    Voice.config = { ...Voice.config, ...(data.brand.voice?.speech || {}) };
    return data;
  }

  global.VD = { THEMES, PLATFORM_TAG_LIMITS, generateAd, hashtagsFor, captionFor, cardHTML, loadData, Voice };
})(typeof window !== "undefined" ? window : globalThis);
