'use strict';
// Static checks on the site files: public-copy rules, consent gating, theme setup, config consistency.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PRIVACY_POLICY_VERSION } = require('../netlify/functions/lib/config');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FLOW = ['waitlist.html', 'waitlist-check-email.html', 'waitlist-confirm.html', 'privacy.html', 'terms.html'];
const PUBLIC = ['index.html', 'product.html', ...FLOW];

// Visible text only: drop comments, scripts, styles, tags.
function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

test('policy version is identical in the server, the consent banner, and the privacy page', () => {
  assert.match(read('assets/consent.js'), new RegExp(`POLICY_VERSION = '${PRIVACY_POLICY_VERSION}'`));
  assert.ok(read('privacy.html').includes(`Version ${PRIVACY_POLICY_VERSION}`));
});

test('public copy never uses the banned words or competitor names', () => {
  const banned = /\b(prevent\w*|detect\w*|diagnos\w*|treat\w*|whoop|oura|fitbit|garmin|apple watch|polar)\b/i;
  for (const f of PUBLIC) {
    const text = visibleText(read(f));
    const m = text.match(banned);
    // Legal pages must be able to say what STRYD is NOT intended to do; they currently avoid it entirely.
    assert.equal(m, null, `${f} contains banned word: ${m && m[0]}`);
  }
});

test('no gray text on waitlist pages: --ink-muted is defined but never used', () => {
  const css = read('assets/waitlist.css');
  const uses = css.match(/var\(--ink-muted\)/g) || [];
  assert.equal(uses.length, 0);
  for (const f of FLOW) assert.equal(read(f).includes('ink-muted'), false, f);
});

test('flow pages: no flash of wrong theme, native controls follow theme, shared chrome', () => {
  for (const f of FLOW) {
    const html = read(f);
    assert.match(html, /<meta name="color-scheme" content="dark light">/, f);
    assert.match(html, /localStorage\.getItem\('stryd_theme'\)/, f + ' head theme script');
    assert.ok(html.indexOf("stryd_theme") < html.indexOf('waitlist.css'), f + ': theme script must run before CSS loads');
    assert.match(html, /data-theme-toggle/, f);
    assert.match(html, /data-cookie-settings/, f);
    assert.match(html, /href="\/privacy"/, f);
    assert.match(html, /href="\/terms"/, f);
  }
  const css = read('assets/waitlist.css');
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /color-scheme: light/);
});

test('analytics is consent-gated: no PostHog reference in any page, only consent.js loads it', () => {
  for (const f of PUBLIC) {
    const html = read(f);
    // The privacy page names PostHog as a provider in its visible text; no page may load it or reference the proxy.
    assert.equal(/<script[^>]*posthog|<link[^>]*posthog|\/ingest\//i.test(html), false, f);
    if (f !== 'privacy.html') assert.equal(/posthog/i.test(html), false, f);
  }
  const consent = read('assets/consent.js');
  assert.match(consent, /accepted\(\)/);
  // The script is only injected inside the config-fetch callback, which re-checks consent.
  assert.ok(consent.indexOf("'/ingest/static/array.js'") > consent.indexOf('!accepted()'));
  assert.match(consent, /session_recording: \{ maskAllInputs: true \}/);
  assert.match(consent, /before_send: beforeSend/);
  assert.match(consent, /token=REDACTED/);
});

test('confirm page: strips the token from the URL before it POSTs, never uses GET, no referrer', () => {
  const js = read('assets/confirm.js');
  assert.ok(js.indexOf('history.replaceState') < js.indexOf("fetch('/api/waitlist/confirm'"));
  assert.match(js, /method: 'POST'/);
  const html = read('waitlist-confirm.html');
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /noindex/);
});

test('email input is excluded from session replay', () => {
  assert.match(read('waitlist.html'), /class="control ph-no-capture"[^>]*name="email"|name="email"[^>]*class="control ph-no-capture"/);
});

test('honeypot is present, off-screen, and not display:none', () => {
  const html = read('waitlist.html');
  assert.match(html, /name="company_website"/);
  assert.match(html, /class="hp"/);
  assert.match(read('assets/waitlist.css'), /\.hp \{ position: absolute !important; left: -10000px/);
});

test('every waitlist CTA on the homepage links to /waitlist (no second intake path, no leftover modal)', () => {
  const html = read('index.html');
  assert.equal(/data-open-waitlist|waitlist-modal|data-waitlist-counter/.test(html), false);
  assert.equal(/data-netlify="true"[^>]*name="waitlist"|name="waitlist"[^>]*data-netlify/.test(html), false);
  const ctas = html.match(/data-cta="Join[^"]*"/g) || [];
  assert.ok(ctas.length >= 8, 'expected tagged CTAs');
  assert.match(html, /data-track-video="hero_demo"/);
  // The clinician/partner contact form is untouched.
  assert.match(html, /<form name="contact" data-netlify="true"/);
});

test('netlify.toml: routes, schedule, proxy ordering, headers', () => {
  const t = read('netlify.toml');
  for (const frag of ['/api/waitlist/confirm', '/api/waitlist/count', '/api/waitlist"', '/api/config', '/go/:slug', '/waitlist.html',
    '/waitlist-check-email.html', '/waitlist-confirm.html', '/privacy.html', '/terms.html']) {
    assert.ok(t.includes(frag), 'missing ' + frag);
  }
  assert.match(t, /\[functions\."sync-retry"\][\s\S]*schedule = "\*\/15 \* \* \* \*"/);
  assert.ok(t.indexOf('/ingest/static/*') < t.indexOf('from = "/ingest/*"'), 'static assets rule must come first');
  assert.match(t, /frame-ancestors 'none'/);
  assert.match(t, /Strict-Transport-Security/);
  assert.match(t, /\/waitlist-confirm\.html"[\s\S]*Referrer-Policy = "no-referrer"/);
  assert.equal(/APP_ENV\s*=/.test(t.replace(/#.*$/gm, '')), false, 'APP_ENV must not be set in toml (build-only; use the Netlify UI)');
});

test('no secrets are committed in site files or functions', () => {
  const files = [...PUBLIC, 'netlify.toml', ...fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => /\.(js|css)$/.test(f)).map((f) => 'assets/' + f)];
  for (const f of files) {
    const txt = read(f);
    assert.equal(/service_role|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(txt), false, f + ' looks like it contains a key');
    assert.equal(/SUPABASE_SERVICE_ROLE_KEY|CUSTOMERIO_API_KEY/.test(txt), false, f + ' references a server secret');
  }
});

test('reporting views never select email, and every table/view is locked down', () => {
  const views = read('supabase/migrations/0003_reporting_views.sql');
  const bodies = views.split('create view').slice(1).map((v) => v.split(';')[0]);
  for (const b of bodies) assert.equal(/\bemail\b/i.test(b), false, 'a view exposes email');
  assert.equal(bodies.length, 9);
  const tables = read('supabase/migrations/0001_waitlist_tables.sql') + read('supabase/migrations/0002_rate_limit.sql');
  const names = [...tables.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  for (const n of names) {
    assert.match(tables, new RegExp(`alter table public\\.${n}\\s+enable row level security`), n + ' needs RLS');
    assert.match(tables, new RegExp(`revoke all on public\\.${n}\\s+from anon, authenticated`), n + ' needs revoke');
  }
  assert.match(views, /revoke all on [\s\S]*from anon, authenticated/);
});

test('email drafts follow the language rules (no banned words, no competitors, no prices or dates)', () => {
  const doc = read('docs/customerio-emails.md');
  // Only the copy blocks (fenced) are customer-facing.
  const blocks = (doc.match(/```[\s\S]*?```/g) || []).join('\n');
  assert.ok(blocks.includes('Confirm my email') && blocks.includes("You're in."));
  assert.equal(/\b(prevent\w*|detect\w*|diagnos\w*|treat\w*|whoop|oura|fitbit|garmin)\b/i.test(blocks), false);
  assert.equal(/\$\d|\b20\d\d\b|\bfree\b/i.test(blocks), false, 'no prices or dates');
  assert.match(blocks, /72 hours/);
});

test('required docs exist', () => {
  for (const f of ['docs/setup.md', 'docs/data-deletion-runbook.md', 'docs/customerio-emails.md', 'docs/posthog-dashboard.md', 'docs/security-sweep.md', 'LEGAL_REVIEW_NEEDED.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  }
});

test('homepage has light mode: no-flash script, toggle in nav + drawer, theme CSS scoped to light', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="color-scheme" content="dark light">/);
  assert.ok(html.indexOf("stryd_theme") < html.indexOf('assets/stryd.css'), 'theme script must run before CSS loads');
  assert.equal((html.match(/data-theme-toggle/g) || []).length, 2, 'toggle in header and in the mobile menu');
  assert.match(html, /assets\/home-light\.css/);
  assert.match(html, /assets\/theme\.js/);
  // The hero letters must not hardcode white (it would be invisible in light mode).
  assert.equal(/s\.style\.color\s*=\s*'#fff'/.test(html), false);
  const css = read('assets/home-light.css');
  // Every rule that changes colors is either the shared toggle or scoped to the light theme (dark stays untouched).
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
  for (const sel of rules) {
    const ok = /data-theme="light"/.test(sel) || /^\.theme-toggle|^\.mobile-drawer \.theme-toggle|^:root$/.test(sel);
    assert.ok(ok, 'unscoped selector in home-light.css: ' + sel);
  }
  assert.match(css, /\.partner-tag[\s\S]*color: #fff !important/, 'colored logo tags keep white text');
  assert.equal(/(?<![\w-])color:#fff/.test(html.slice(html.indexOf('<style>'), html.indexOf('</style>'))), false, 'page styles use theme variables, not hardcoded white');
});

test('cookie banner clears the Netlify preview toolbar on *.netlify.app only', () => {
  const js = read('assets/consent.js');
  assert.match(js, /\\.netlify\\.app\$\/\.test\(location\.hostname\)\) banner\.style\.bottom = '84px'/);
});
