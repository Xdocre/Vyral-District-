# Vyral District

**Where accounts go to blow up.** Vyral District promotes social media growth and paid growth.

This repo has:

| Part | File | What it does |
|---|---|---|
| Social page | `index.html` | The brand's home page: profile header, services, an ad feed with captions and hashtags, packages, and an audit sign-up. |
| Ad Studio | `studio.html` | Generates new ads in the brand voice for any niche. You can edit them, preview the caption and hashtags for each platform, play the voiceover, download a PNG and queue ads for posting. |
| Ads | `data/ads.json` | 8 ready-to-run ads, each with a headline, body, CTA, voiceover script and 12 hashtags. |
| Ad images | `assets/ads/*.png` | 1080×1080 images for every ad, rendered with `npm run render`. |
| Auto-poster | `autopost/post.mjs` | Posts the next unposted ad to X, a Facebook Page and Instagram, trimming the hashtags to suit each platform. |
| Schedule | `.github/workflows/autopost.yml` | Runs the auto-poster 3 times a day on GitHub Actions. |

## Brand voice: "The Hype Architect"

Bold, confident, street-smart, zero fluff, results first.

- Hook in the first 5 words.
- Talk to one creator ("you").
- Numbers beat adjectives.
- One clear call to action per ad.
- Never promise fake followers or guaranteed virality.

The voiceover uses the browser's built-in speech engine at 1.05× speed and a lower pitch. In Ad Studio you can choose a different voice and change the speed and pitch.

## Hashtag strategy

Every ad starts with the brand tags `#VyralDistrict #GoVyral`, then niche tags, then broad growth tags. The number of tags depends on the platform:

| Instagram | TikTok | Facebook | LinkedIn | X |
|---|---|---|---|---|
| 12 | 5 | 3 | 3 | 2 |

## Run it locally

```bash
npm run serve        # open http://localhost:3000 and http://localhost:3000/studio.html
npm run post         # dry run: prints exactly what would be posted, publishes nothing
npm run render       # re-render ad PNGs after editing data/ads.json
```

## Turn on auto-posting

The auto-poster is a **dry run by default**. To go live:

1. **Host the site** (GitHub Pages, Vercel or Netlify) so the ad images have public URLs. Instagram needs them.
2. In GitHub, go to **Settings → Secrets and variables → Actions** and add:
   - **Secrets** (add only the platforms you use):
     - X: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` (from developer.x.com; the app needs Read and Write)
     - Facebook Page: `FB_PAGE_ID`, `FB_PAGE_TOKEN` (a long-lived Page access token)
     - Instagram Business or Creator account linked to that Page: `IG_USER_ID`
   - **Variables**:
     - `IMAGE_BASE_URL`, for example `https://yourdomain.com/assets/ads`
     - `POST_LIVE` = `true`
3. Test it: **Actions → Vyral District auto-post → Run workflow**.

Each run posts the next ad in `data/ads.json` and records it in `autopost/state.json`. After every ad has gone out, it starts again from the first. To add more ads, build them in Ad Studio, click **Export for auto-poster**, replace `data/ads.json` with the exported file, then run `npm run render`.

> TikTok doesn't allow organic photo posts through a simple API. Use the TikTok captions and voiceover scripts from Ad Studio for TikTok videos, or run them as paid TikTok ads.
