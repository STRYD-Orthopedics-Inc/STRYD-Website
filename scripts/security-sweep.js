#!/usr/bin/env node
'use strict';
// Post-deploy security sweep (handoff section 11.3): prints a pass/fail table.
//
//   node scripts/security-sweep.js https://strydorthopedics.com
//   node scripts/security-sweep.js https://deploy-preview-1--site.netlify.app --allow-writes --email you@your-team-domain.com
//   node scripts/security-sweep.js http://localhost:8123 --skip-headers        (local dev; Netlify headers don't exist there)
//
// By default it makes NO writes to signup tables. --allow-writes also submits real signups for --email, which MUST be a
// team-owned address (on production this sends a real confirmation email). The rate-limit test runs last and locks the
// sweeping IP out for ~10 minutes.
//
// Checks that need your Supabase/Netlify/Customer.io dashboards (RLS with the anon key, secret scanning of git history,
// SPF/DKIM/DMARC on a received message, dependency audit) are listed at the end as MANUAL with the exact commands.

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');
const allowWrites = args.includes('--allow-writes');
const skipHeaders = args.includes('--skip-headers');
const email = (args[args.indexOf('--email') + 1] || '').trim();
if (!base) { console.error('usage: node scripts/security-sweep.js <baseUrl> [--allow-writes --email team@addr] [--skip-headers]'); process.exit(2); }
if (allowWrites && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { console.error('--allow-writes requires --email <team-owned address>'); process.exit(2); }

const origin = new URL(base).origin;
const rows = [];
const rec = (area, name, ok, detail) => rows.push({ area, name, ok, detail: detail || '' });

async function call(path, { method = 'GET', body, headers = {}, raw, redirect = 'manual', withOrigin = true } = {}) {
  const h = { ...headers };
  if (withOrigin && method !== 'GET') h.Origin = origin;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined, redirect });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
}

const good = (over = {}) => ({ email: 'sweep+0@example.invalid', segment: 'other', where_heard: 'search', age_attested: true, consent: true, ...over });

(async () => {
  /* ---- security headers ---- */
  if (!skipHeaders) {
    for (const path of ['/', '/waitlist']) {
      const r = await call(path);
      const h = (n) => r.headers.get(n) || '';
      rec('headers', `${path} CSP present with frame-ancestors + default-src`, /default-src 'self'/.test(h('content-security-policy')) && /frame-ancestors 'none'/.test(h('content-security-policy')));
      rec('headers', `${path} HSTS`, /max-age=\d{7,}/.test(h('strict-transport-security')));
      rec('headers', `${path} nosniff`, h('x-content-type-options') === 'nosniff');
      rec('headers', `${path} referrer policy`, !!h('referrer-policy'));
      rec('headers', `${path} permissions policy`, !!h('permissions-policy'));
      rec('headers', `${path} framing protection`, h('x-frame-options').toUpperCase() === 'DENY' || /frame-ancestors/.test(h('content-security-policy')));
    }
    const c = await call('/waitlist/confirm');
    rec('tokens', 'confirm page sends no Referer (Referrer-Policy: no-referrer) and is not cached', c.headers.get('referrer-policy') === 'no-referrer' && /no-store/.test(c.headers.get('cache-control') || ''));
  }

  /* ---- origin / method / size / parsing ---- */
  let r = await call('/api/waitlist', { method: 'POST', body: good(), withOrigin: false });
  rec('origin', 'POST without Origin rejected', r.status === 403, `status ${r.status}`);
  r = await call('/api/waitlist', { method: 'POST', body: good(), headers: { Origin: 'https://evil.example' }, withOrigin: false });
  rec('origin', 'POST from foreign Origin rejected', r.status === 403, `status ${r.status}`);
  r = await call('/api/waitlist');
  rec('origin', 'GET /api/waitlist -> 405', r.status === 405, `status ${r.status}`);
  r = await call('/api/waitlist', { method: 'POST', raw: 'x'.repeat(11 * 1024) });
  rec('input', 'oversized body (11 KB) -> 413', r.status === 413, `status ${r.status}`);
  r = await call('/api/waitlist', { method: 'POST', raw: '{not json' });
  rec('input', 'malformed JSON -> 400', r.status === 400, `status ${r.status}`);
  r = await call('/api/waitlist', { method: 'POST', body: good({ admin: true, consent_policy_version: 'x' }) });
  rec('input', 'unknown fields (incl. client-supplied policy version) -> 400', r.status === 400, `status ${r.status}`);

  /* ---- honeypot (no write) ---- */
  r = await call('/api/waitlist', { method: 'POST', body: good({ hp: 'bot' }) });
  rec('abuse', 'honeypot filled -> pretends success', r.status === 200 && r.json && r.json.ok === true, `status ${r.status}`);

  /* ---- real writes (opt-in). Run BEFORE the hostile-input checks: those consume the per-IP rate limit. ---- */
  if (allowWrites) {
    const a = await call('/api/waitlist', { method: 'POST', body: good({ email, sport: "<img src=x onerror=1> ' --" }) });
    const b = await call('/api/waitlist', { method: 'POST', body: good({ email }) });
    rec('abuse', 'valid submit -> 200 ok', a.status === 200 && a.json && a.json.ok === true, `status ${a.status}`);
    rec('abuse', 'duplicate submit returns an identical response (no enumeration)', a.text === b.text && a.status === b.status, `${a.text} vs ${b.text}`);
  }

  /* ---- hostile input never causes a 5xx or a stored/reflected payload ---- */
  const hostile = ["<script>alert(1)</script>@x.co", "a'; drop table waitlist_signups;--@x.co", '\u0000@x.co', 'ünï@x.co', '"><img src=x onerror=1>@x.co', 'a'.repeat(300) + '@x.co'];
  let bad = 0;
  for (const e of hostile) { const x = await call('/api/waitlist', { method: 'POST', body: good({ email: e }) }); if (x.status !== 400 && x.status !== 429) bad++; if (/<script|onerror/.test(x.text)) bad++; }
  rec('input', 'hostile emails rejected with 400 (never 5xx, never reflected)', bad === 0, `${bad} problem(s)`);
  for (const field of ['segment', 'where_heard']) {
    const x = await call('/api/waitlist', { method: 'POST', body: good({ [field]: "<b>'; --" }) });
    rec('input', `hostile ${field} -> 400`, x.status === 400 || x.status === 429, `status ${x.status}`);
  }
  const att = await call('/api/waitlist', { method: 'POST', body: good({ email: 'sweep+attr@example.invalid', attribution: { utm_source: '<script>', utm_content: "x'; --", lk: '../../etc', landing_path: 'javascript:alert(1)', referrer_host: 'evil.com/<x>' } }) });
  rec('input', 'hostile attribution values do not break submit (they are dropped)', att.status !== 500, `status ${att.status}`);

  /* ---- confirm endpoint ---- */
  r = await call('/api/waitlist/confirm?token=' + 'a'.repeat(43));
  rec('tokens', 'GET confirm never changes state (405)', r.status === 405, `status ${r.status}`);
  r = await call('/api/waitlist/confirm', { method: 'POST', body: { token: 'a'.repeat(43) } });
  rec('tokens', 'unknown token -> invalid_or_expired', r.json && r.json.reason === 'invalid_or_expired', JSON.stringify(r.json));
  r = await call('/api/waitlist/confirm', { method: 'POST', body: { token: "' or 1=1 --" } });
  rec('tokens', 'malformed token -> invalid_or_expired (no DB error)', r.json && r.json.reason === 'invalid_or_expired', JSON.stringify(r.json));

  /* ---- counter ---- */
  r = await call('/api/waitlist/count');
  rec('privacy', 'count endpoint shape ok (no number when show:false)', r.json && ((r.json.show === false && !('count' in r.json)) || (r.json.show === true && typeof r.json.count === 'number')), r.text.slice(0, 80));

  /* ---- tracked links ---- */
  for (const [path, why] of [['/go/does-not-exist-zz', 'unknown slug'], ['/go/x?next=https://evil.example&url=https://evil.example', 'next/url params ignored'], ['/go/..%2f..%2fetc', 'path traversal slug'], ['/go/%00', 'null byte']]) {
    const x = await call(path);
    const loc = x.headers.get('location') || '';
    // Safe = a same-origin redirect (Netlify may append the original query string; that is harmless as long as the
    // destination host never changes) or a 4xx rejection of the malformed URL.
    let sameOrigin = false;
    try { sameOrigin = x.status === 302 && new URL(loc, base).origin === origin; } catch { /* invalid */ }
    rec('redirects', `${why} -> stays on-site (or is rejected)`, sameOrigin || (x.status >= 400 && x.status < 500), `status ${x.status} ${loc}`);
  }

  /* ---- config + secret leakage in public files ---- */
  r = await call('/api/config');
  rec('secrets', 'envCheck (previews only) holds yes/no flags, never values', !r.json || !r.json.envCheck || Object.entries(r.json.envCheck).every(([k, v]) => typeof v === 'boolean' || v === null || (k === 'app_env' && typeof v === 'string' && v.toLowerCase() !== 'production' && v.length < 20)), JSON.stringify(r.json && r.json.envCheck));
  rec('secrets', '/api/config exposes only public values', r.json && Object.keys(r.json).every((k) => ['analytics', 'posthogKey', 'uiHost', 'policyVersion', 'envCheck'].includes(k)), r.text.slice(0, 120));
  const files = ['/', '/waitlist', '/assets/consent.js', '/assets/waitlist.js', '/assets/analytics.js', '/assets/confirm.js', '/assets/theme.js', '/index.html'];
  let leak = [];
  for (const f of files) { const x = await call(f); x.text = x.text.replace(/data-netlify-cwv-token="[^"]*"/g, ''); /* Netlify's own injected preview token, not ours */ if (/service_role|SUPABASE_SERVICE|CUSTOMERIO_API_KEY|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(x.text)) leak.push(f); }
  rec('secrets', 'no keys in public HTML/JS', leak.length === 0, leak.join(','));

  /* ---- consent gating (static) ---- */
  const pages = ['/', '/waitlist', '/privacy'];
  let ph = [];
  for (const f of pages) { const x = await call(f); if (/<script[^>]*posthog|\/ingest\//i.test(x.text)) ph.push(f); }
  rec('privacy', 'no PostHog script or proxy path in served HTML (loads only after consent)', ph.length === 0, ph.join(','));

  /* ---- rate limit (opt-in, always last) ---- */
  if (allowWrites) {
    // Rate limit last: 5 / 10 min per IP.
    let limited = false;
    for (let i = 0; i < 8 && !limited; i++) { const x = await call('/api/waitlist', { method: 'POST', body: good({ email: `sweep+rl${i}@example.invalid` }) }); if (x.status === 429) limited = true; }
    rec('abuse', 'rate limit trips (429) after repeated submits', limited);
  }

  /* ---- report ---- */
  const w = Math.max(...rows.map((x) => x.area.length));
  console.log(`\nSecurity sweep: ${base}\n`);
  rows.forEach((x) => console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.area.padEnd(w)}  ${x.name}${x.ok ? '' : '   [' + x.detail + ']'}`));
  const fails = rows.filter((x) => !x.ok).length;
  console.log(`\n${rows.length - fails}/${rows.length} passed${fails ? `, ${fails} FAILED` : ''}`);
  console.log(`
MANUAL (need dashboards / credentials; see docs/security-sweep.md):
  [ ] RLS: anon key cannot read any table or view (curl commands in docs/setup.md)
  [ ] service role key absent from repo + git history:  git log -p --all -S"service_role" ; git grep -n "eyJ" $(git rev-list --all)
  [ ] environment isolation: a preview deploy writes only to *_test tables and sends no real email
  [ ] PostHog: zero requests before consent; replay inputs masked; no email in any event
  [ ] logs: no emails/tokens/bodies in Netlify function logs
  [ ] email: SPF, DKIM, DMARC pass on a received test message
  [ ] dependencies: ${'`npm audit`'} (the project currently has no npm dependencies)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('sweep crashed:', e.message); process.exit(2); });
