# SEO: what is in place, and what only a person can do

Adapted from the older STRYD site (`Downloads/STRYD-Orthopedics-Website`). **Techniques only; none of its copy.** That site was clinic-first
("Rehab Reimagined", PT, Defense), and our public copy rules still apply: no "prevent / detect / diagnose / treat", no competitor names, wellness framing.
A test (`tests/seo.test.js`) enforces those rules across titles, descriptions, Open Graph tags and structured data.

## In the code

| Area | What it does |
|---|---|
| Titles + descriptions | Unique, length-checked title and meta description on each indexable page (`/`, `/waitlist`, `/privacy`, `/terms`). |
| Canonical + robots | Absolute canonical URL on every indexable page. `index,follow,max-image-preview:large`. |
| Open Graph + Twitter | Share cards on every indexable page, using `assets/images/og.jpg` (1200x630, 72 KB, headline + sleeve). |
| Structured data (JSON-LD) | Homepage: `Organization` (with the Birmingham address, email contact and social profiles), `WebSite`, `Product` (no price/offer claims) and `FAQPage`. Other pages: `WebPage` + `BreadcrumbList`. |
| FAQ = FAQPage | The visible FAQ and its structured data come from the same list; a test fails if they ever drift apart. |
| Brand disambiguation | An FAQ answer says STRYD Orthopedics is an independent company, **without naming any other company** (the old site named two). |
| `robots.txt` + `sitemap.xml` | Allows everything except `/api/`, `/go/`, `/ingest/`. Sitemap lists only the 4 indexable pages. The noindex pages stay crawlable so Google can see their `noindex`. |
| `noindex` | `/waitlist/check-email`, `/waitlist/confirm`, `/404.html` and `product.html` are `noindex,follow`. API and `/go/` responses send `X-Robots-Tag: noindex`. Netlify already adds `noindex` to every deploy-preview URL. |
| 404 page | Branded `404.html` (noindex) instead of Netlify's default. |
| Speed (also a ranking signal) | Hero poster 1,190 KB PNG -> 14 KB WebP, preloaded. Header logo is a 600px file instead of a 4000px one. Width/height on images and the video (no layout shift). Cache headers on assets. |
| Semantics + accessibility | `lang="en-US"`, one `h1`, a `<main>` landmark, a skip link, the mobile menu is a real `<nav>`, and the contact form's dropdown has an accessible name. |
| One canonical host | `www.strydorthopedics.com` -> `strydorthopedics.com` (301). Takes effect once `www` is added as a domain alias in Netlify. |
| Favicons | `favicon.svg`, `favicon.png` (32px), `apple-touch-icon.png`; `/favicon.ico` is served too. |

## What only a person can do (after launch)

1. **Google Search Console:** add `https://strydorthopedics.com` (a "Domain" property verified with a DNS TXT record in GoDaddy is best), then **Sitemaps > submit `sitemap.xml`**. Use **URL Inspection > Request indexing** on the homepage and `/waitlist`.
2. **Bing Webmaster Tools:** import from Search Console (one click). It feeds Bing and several other engines.
3. **Netlify:** add `www.strydorthopedics.com` as a domain alias (the redirect rule is already in `netlify.toml`) and confirm HTTPS is on for both.
4. **Check the share card:** paste the homepage URL into LinkedIn's Post Inspector and a Facebook/X link preview once live. They cache aggressively, so use their "re-scrape" buttons after any change to `og.jpg`.
5. **Google Business Profile** (optional): the Birmingham address is public in the structured data; a verified profile can help local searches for the company name.
6. **Backlinks and brand signals:** the profiles in `sameAs` (LinkedIn, Instagram, TikTok) should link back to the site, and partners listed on the homepage can link to it too.

## Honest limits

- Meta tags and structured data make a page eligible and clear; they do not by themselves rank it. New sites take weeks to be indexed.
- Google restricts FAQ rich results to a small set of sites, so the FAQ snippet may never display. The markup is harmless and also helps other engines and assistants.
- The homepage is mostly one page, so there is little text for search to work with. More pages that answer real questions (for example a "Who it's for" page, once the team decides on one) would help more than any tag.
- Keep adding pages to `sitemap.xml` and give each its own title, description, canonical and structured data. The tests in `tests/seo.test.js` will tell you what is missing.

## Performance: measured, and the one thing left

Lighthouse on the live preview (mobile preset, simulated slow 4G, two runs): **Accessibility 97, Best practices 96, Performance 73-74**, layout shift 0.002 (was 0.168), blocking time 0 ms, first paint 3.3 s. Locally (no network throttling) SEO scores 100.

- **Accessibility 97:** the only miss is white text on the brand-blue `#0A7AFF` buttons (4.0:1; AA needs 4.5:1). The waitlist pages use `#006FBF` (5.2:1). Fixing it on the homepage is a small visual change that needs a decision.
- **Best practices 96:** the remaining note is Netlify's own preview analytics script being blocked by our strict security policy. That is intentional (no analytics before consent); it is harmless. To silence it, turn off Real User Metrics in the Netlify site settings.
- **Largest paint ~5 s is the video file, not the code.** Chrome counts the video's first frame as the largest paint. The loop is a **10 MB, 4148x2000** H.264 file and its first frame cannot show until the first part of it arrives. The poster (14 KB) paints in about 1.3 s. A re-encode at the size it is actually shown (about 1600 px wide) would be 2-3 MB and look identical here:

  ```
  ffmpeg -i ProductDemoVideo.mp4 -vf "scale=1600:-2" -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart -an ProductDemoVideo-web.mp4
  ```

  (`winget install ffmpeg` on Windows; HandBrake with the "Web" preset and 1600 px width works too.) Then point the hero `<video src>` at the new file. The smaller `WebsiteProductDemo.mp4` already in the repo is *different, older footage* with a watermark, so it is not a substitute.
- Already done: poster 1.2 MB -> 14 KB and preloaded; fonts load without blocking and use size-matched fallbacks; the loop starts after page load and is skipped on Save-Data connections; the 121 sleeve frames only download when the page is idle or on first touch.
