'use strict';
// SEO + hero-viewer static checks. Keeps the SEO setup from quietly breaking in a later edit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const INDEXABLE = { 'index.html': '/', 'waitlist.html': '/waitlist', 'privacy.html': '/privacy', 'terms.html': '/terms' };
const NOINDEX = ['waitlist-check-email.html', 'waitlist-confirm.html', '404.html', 'product.html'];
const SITE = 'https://strydorthopedics.com';

const metaContent = (html, attr, name) => {
  const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`));
  return m ? m[1] : null;
};
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&mdash;/g, '—').replace(/\s+/g, ' ').trim();

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xC3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

test('SEO: every indexable page has title, description, canonical, robots, Open Graph and Twitter tags', () => {
  const seenTitle = new Set();
  const seenDesc = new Set();
  for (const [f, p] of Object.entries(INDEXABLE)) {
    const html = read(f);
    assert.match(html, /<html lang="en-US"/, f);
    const titles = html.match(/<title>[^<]*<\/title>/g) || [];
    assert.equal(titles.length, 1, f + ' needs exactly one <title>');
    const title = decode(titles[0].replace(/<\/?title>/g, ''));
    assert.ok(title.length >= 15 && title.length <= 65, `${f} title length ${title.length}: ${title}`);
    const desc = decode(metaContent(html, 'name', 'description') || '');
    assert.ok(desc.length >= 70 && desc.length <= 160, `${f} description length ${desc.length}`);
    assert.ok(!seenTitle.has(title) && !seenDesc.has(desc), f + ' title/description must be unique');
    seenTitle.add(title);
    seenDesc.add(desc);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE}${p}">`), f + ' canonical');
    assert.match(metaContent(html, 'name', 'robots') || '', /^index,follow/, f);
    assert.equal(metaContent(html, 'property', 'og:url'), SITE + p, f);
    assert.equal(decode(metaContent(html, 'property', 'og:description')), desc, f);
    assert.equal(metaContent(html, 'property', 'og:image'), SITE + '/assets/images/og.jpg', f);
    assert.equal(metaContent(html, 'name', 'twitter:card'), 'summary_large_image', f);
    assert.equal((html.match(/name="theme-color"/g) || []).length, 2, f + ' theme-color for both schemes');
  }
});

test('SEO: noindex pages are marked noindex and are NOT in the sitemap', () => {
  const sitemap = read('sitemap.xml');
  for (const f of NOINDEX) assert.match(read(f), /<meta name="robots" content="noindex,follow">/, f);
  for (const u of ['/waitlist/check-email', '/waitlist/confirm', '/404', '/product']) assert.equal(sitemap.includes(u), false, u);
});

test('SEO: social image is a real 1200x630 JPEG and stays light', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'assets/images/og.jpg'));
  assert.deepEqual(jpegSize(buf), { w: 1200, h: 630 });
  assert.ok(buf.length < 400 * 1024);
});

test('SEO: sitemap lists exactly the indexable pages, and robots.txt points at it', () => {
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepEqual(locs, Object.values(INDEXABLE).map((p) => SITE + p).sort());
  const robots = read('robots.txt');
  assert.match(robots, /Sitemap: https:\/\/strydorthopedics\.com\/sitemap\.xml/);
  for (const d of ['/api/', '/go/', '/ingest/']) assert.ok(robots.includes('Disallow: ' + d), d);
  assert.equal(/Disallow: \/\s*$/m.test(robots), false, 'must not block the whole site');
  assert.equal(/Disallow: \/waitlist/.test(robots), false, 'noindex pages must stay crawlable so the noindex is seen');
});

test('SEO: structured data parses, has the right types, and carries no banned words', () => {
  const byType = Object.fromEntries(ldBlocks(read('index.html')).map((b) => [b['@type'], b]));
  assert.deepEqual(Object.keys(byType).sort(), ['FAQPage', 'Organization', 'Product', 'WebSite']);
  assert.equal(byType.Organization.url, SITE + '/');
  assert.equal(byType.Organization.address.postalCode, '35203');
  assert.ok(byType.Organization.sameAs.length >= 3);
  assert.equal(byType.Product.offers, undefined, 'no price/offer claims until they exist');
  for (const f of ['waitlist.html', 'privacy.html', 'terms.html']) {
    assert.deepEqual(ldBlocks(read(f)).map((b) => b['@type']).sort(), ['BreadcrumbList', 'WebPage'], f);
  }
  const banned = /\b(prevent\w*|detect\w*|diagnos\w*|treat\w*|whoop|oura|fitbit|garmin|stryker|medical technology|rehab\w*)\b/i;
  for (const f of [...Object.keys(INDEXABLE), ...NOINDEX]) {
    const html = read(f);
    const metas = [...html.matchAll(/<meta [^>]*content="([^"]*)"/g)].map((m) => m[1]).join(' ');
    const json = ldBlocks(html).map((b) => JSON.stringify(b)).join(' ');
    // "not a medical device" is the one allowed medical phrase (it is in the FAQ); everything else is checked.
    const text = (metas + ' ' + json).replace(/not a medical device/gi, '');
    assert.equal(banned.test(text), false, `${f}: banned word in meta/structured data: ${(text.match(banned) || [])[0]}`);
  }
});

test('SEO: FAQPage structured data matches the visible FAQ exactly', () => {
  const html = read('index.html');
  const ld = ldBlocks(html).find((b) => b['@type'] === 'FAQPage');
  const visible = [...html.matchAll(/<details class="glass faq-item" data-faq-id="[^"]+">\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((m) => [decode(m[1]), decode(m[2])]);
  const fromLd = ld.mainEntity.map((q) => [decode(q.name), decode(q.acceptedAnswer.text)]);
  assert.ok(visible.length >= 6);
  assert.deepEqual(fromLd, visible);
  assert.ok(visible.some(([q]) => /similar names/.test(q)), 'brand disambiguation answer present, without naming other companies');
});

test('SEO: semantics and performance basics', () => {
  const html = read('index.html');
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
  assert.match(html, /<main id="main">[\s\S]*<\/main>/);
  assert.match(html, /<a class="skip-link" href="#main">/);
  assert.match(html, /<link rel="preload" as="image" href="\/assets\/images\/hero-sleeve\.webp"/);
  assert.match(html, /poster="\/assets\/images\/hero-sleeve\.webp"/);
  for (const f of [...Object.keys(INDEXABLE), '404.html']) {
    for (const img of read(f).match(/<img [^>]*>/g) || []) {
      assert.match(img, /alt="/, f + ' img needs alt: ' + img.slice(0, 60));
      assert.match(img, /width="\d+"/, f + ' img needs width: ' + img.slice(0, 60));
      assert.match(img, /height="\d+"/, f + ' img needs height');
    }
  }
  assert.ok(fs.statSync(path.join(ROOT, 'assets/images/hero-sleeve.webp')).size < 60 * 1024, 'poster stays light');
  const toml = read('netlify.toml');
  assert.match(toml, /https:\/\/www\.strydorthopedics\.com\/\*/);
  assert.match(toml, /for = "\/api\/\*"[\s\S]*X-Robots-Tag = "noindex, nofollow"/);
});

test('hero viewer: wired into the hero, assets present, built to return to the loop', () => {
  const html = read('index.html');
  assert.match(html, /<div class="hero-bubble" data-hero-viewer data-frames="121" data-src="\/assets\/spin\/"/);
  assert.match(html, /assets\/hero-viewer\.js/);
  assert.match(html, /<video class="hero-video"[^>]*autoplay muted loop playsinline/);
  assert.match(html, /touch-action:pan-y/, 'vertical swipes must keep scrolling the page');
  for (const set of ['sd', 'hd']) {
    const files = fs.readdirSync(path.join(ROOT, 'assets/spin', set));
    assert.equal(files.length, 121, set);
    assert.ok(files.includes('000.webp') && files.includes('120.webp'), set);
  }
  const js = read('assets/hero-viewer.js');
  assert.match(js, /IDLE_MS/);
  assert.match(js, /returnToLoop/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /saveData/, 'does not preload frames on Save-Data connections');
});
