'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeps, post, goodBody, captureConsole } = require('./helpers');
const { hashToken } = require('../netlify/functions/lib/token');

const submit = (deps) => require('../netlify/functions/waitlist').createHandler(deps);
const confirm = (deps) => require('../netlify/functions/waitlist-confirm').createHandler(deps);
const count = (deps) => require('../netlify/functions/waitlist-count').createHandler(deps);
const go = (deps) => require('../netlify/functions/go').createHandler(deps);
const retry = (deps) => require('../netlify/functions/sync-retry').createHandler(deps);

const rows = (ctx) => ctx.db.tables.waitlist_signups_test || [];
// The confirm token is only ever in the Customer.io event data; pull it from the fake.
const tokenFromCio = (ctx) => {
  const ev = ctx.cio.calls.filter((c) => c[0] === 'track' && c[2] === 'waitlist_submitted').pop();
  return new URL(ev[3].confirm_url).searchParams.get('token');
};

test('submit: happy path writes to the _test table, syncs to Customer.io, stores only the token hash', async () => {
  const ctx = createDeps();
  const res = await submit(ctx.deps)(post(goodBody()));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(rows(ctx).length, 1);
  const r = rows(ctx)[0];
  assert.equal(r.email, 'jordan.smith@example.com');
  assert.equal(r.first_name_guess, 'Jordan');
  assert.equal(r.status, 'pending');
  assert.equal(r.cio_sync_status, 'synced');
  assert.equal(r.age_attested, true);
  assert.equal(r.consent_policy_version, '2026-10-06');
  const token = tokenFromCio(ctx);
  assert.equal(r.confirm_token_hash, hashToken(token));
  assert.notEqual(r.confirm_token_hash, token);
  assert.equal(JSON.stringify(r).includes(token), false);
  assert.equal(ctx.db.tables.waitlist_signups, undefined, 'must not touch the production table');
});

test('submit: identical response for new, pending and confirmed emails (no enumeration)', async () => {
  const ctx = createDeps();
  const h = submit(ctx.deps);
  const a = await h(post(goodBody()));
  const b = await h(post(goodBody()));
  rows(ctx)[0].status = 'confirmed';
  const c = await h(post(goodBody()));
  assert.equal(a.body, b.body);
  assert.equal(b.body, c.body);
  assert.equal(a.statusCode, c.statusCode);
  assert.equal(rows(ctx).length, 1);
});

test('submit: resend only after the 1-hour cooldown, and it rotates the token', async () => {
  const ctx = createDeps();
  const h = submit(ctx.deps);
  await h(post(goodBody()));
  const first = tokenFromCio(ctx);
  await h(post(goodBody()));
  assert.equal(ctx.cio.calls.filter((c) => c[2] === 'waitlist_submitted').length, 1, 'no resend inside cooldown');
  ctx.clock.t += 61 * 60 * 1000;
  await h(post(goodBody()));
  assert.equal(ctx.cio.calls.filter((c) => c[2] === 'waitlist_submitted').length, 2);
  assert.notEqual(tokenFromCio(ctx), first);
  assert.equal(rows(ctx)[0].confirm_token_hash, hashToken(tokenFromCio(ctx)));
});

test('submit: honeypot returns success and stores nothing', async () => {
  const ctx = createDeps();
  const res = await submit(ctx.deps)(post(goodBody({ hp: 'http://spam' })));
  assert.equal(res.statusCode, 200);
  assert.equal(rows(ctx).length, 0);
  assert.equal(ctx.cio.calls.length, 0);
});

test('submit: origin, method, size and JSON checks', async () => {
  const ctx = createDeps();
  const h = submit(ctx.deps);
  assert.equal((await h(post(goodBody(), { origin: 'https://evil.example' }))).statusCode, 403);
  assert.equal((await h({ httpMethod: 'GET', headers: {} })).statusCode, 405);
  assert.equal((await h(post(null, { raw: 'x'.repeat(11 * 1024) }))).statusCode, 413);
  assert.equal((await h(post(null, { raw: '{nope' }))).statusCode, 400);
  assert.equal((await h(post(null, { raw: '[]' }))).statusCode, 400);
  assert.equal(rows(ctx).length, 0);
});

test('submit: validation errors return field codes', async () => {
  const ctx = createDeps();
  const res = await submit(ctx.deps)(post(goodBody({ consent: false, segment: 'x' })));
  assert.equal(res.statusCode, 400);
  const b = JSON.parse(res.body);
  assert.equal(b.ok, false);
  assert.equal(b.errors.consent, 'required');
  assert.equal(b.errors.segment, 'invalid');
});

test('submit: rate limit 5 / 10 min per IP, per-IP isolation, window expiry', async () => {
  const ctx = createDeps();
  const h = submit(ctx.deps);
  for (let i = 0; i < 5; i++) assert.equal((await h(post(goodBody({ email: `p${i}@example.com` })))).statusCode, 200);
  assert.equal((await h(post(goodBody({ email: 'p9@example.com' })))).statusCode, 429);
  assert.equal((await h(post(goodBody({ email: 'q@example.com' }), { ip: '198.51.100.9' }))).statusCode, 200);
  ctx.clock.t += 11 * 60 * 1000;
  assert.equal((await h(post(goodBody({ email: 'p9@example.com' })))).statusCode, 200);
  assert.ok(ctx.db.tables.rate_limit_events.every((e) => /^[0-9a-f]{64}$/.test(e.ip_hash)), 'only hashed IPs stored');
  assert.equal(JSON.stringify(ctx.db.tables.rate_limit_events).includes('203.0.113.7'), false);
});

test('submit: Customer.io failure still succeeds for the user and leaves sync pending for retry', async () => {
  const ctx = createDeps();
  ctx.cio.failNext = true;
  const log = captureConsole();
  const res = await submit(ctx.deps)(post(goodBody()));
  log.restore();
  assert.equal(res.statusCode, 200);
  assert.equal(rows(ctx)[0].cio_sync_status, 'pending');
  assert.equal(rows(ctx)[0].cio_attempts, 1);
});

test('submit: non-production log-only mode makes no Customer.io calls', async () => {
  const ctx = createDeps();
  ctx.cio.forceMode = 'log';
  const log = captureConsole();
  await submit(ctx.deps)(post(goodBody()));
  log.restore();
  assert.equal(ctx.cio.calls.length, 0);
  assert.equal(rows(ctx)[0].cio_sync_status, 'synced');
});

test('submit: attribution is sanitized and stored; unknown attribution keys dropped', async () => {
  const ctx = createDeps();
  await submit(ctx.deps)(post(goodBody({
    attribution: { utm_source: 'tiktok', utm_medium: 'organic', lk: 'tt-ep012', landing_path: '/waitlist?x=1', evil: '1' },
    posthog_distinct_id: 'anon-123',
  })));
  const r = rows(ctx)[0];
  assert.equal(r.utm_source, 'tiktok');
  assert.equal(r.link_slug, 'tt-ep012');
  assert.equal(r.landing_path, '/waitlist');
  assert.equal(r.posthog_distinct_id, 'anon-123');
  assert.equal('evil' in r, false);
});

test('nothing sensitive is logged (emails, tokens, bodies), even on errors', async () => {
  const ctx = createDeps();
  const log = captureConsole();
  ctx.cio.failNext = true;
  await submit(ctx.deps)(post(goodBody({ email: 'secretperson@example.com' })));
  ctx.cio.failNext = false;
  ctx.db.insert = async () => { throw Object.assign(new Error('boom secretperson@example.com'), { name: 'DbError', code: 'XX000' }); };
  await submit(ctx.deps)(post(goodBody({ email: 'another@example.com' })));
  log.restore();
  const all = log.lines.join('\n');
  assert.equal(all.includes('secretperson'), false);
  assert.equal(all.includes('another@example.com'), false);
  assert.equal(/token=/.test(all), false);
});

test('submit: unexpected failure returns a generic 500', async () => {
  const ctx = createDeps();
  ctx.db.selectOne = async () => { throw new Error('db down'); };
  const log = captureConsole();
  const res = await submit(ctx.deps)(post(goodBody()));
  log.restore();
  assert.equal(res.statusCode, 500);
  assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'server_error' });
});

test('confirm: valid token confirms, is idempotent, updates Customer.io once, emits analytics', async () => {
  const ctx = createDeps();
  await submit(ctx.deps)(post(goodBody({ posthog_distinct_id: 'anon-9' })));
  const token = tokenFromCio(ctx);
  const h = confirm(ctx.deps);
  const r1 = await h(post({ token }));
  assert.deepEqual(JSON.parse(r1.body), { ok: true });
  assert.equal(rows(ctx)[0].status, 'confirmed');
  assert.ok(rows(ctx)[0].confirmed_at);
  const r2 = await h(post({ token }));
  assert.deepEqual(JSON.parse(r2.body), { ok: true, already: true });
  assert.equal(ctx.cio.calls.filter((c) => c[2] === 'waitlist_confirmed').length, 1);
  assert.equal(ctx.ph.calls.length, 1);
  assert.equal(ctx.ph.calls[0].anonId, 'anon-9');
  assert.equal(JSON.stringify(ctx.ph.calls).includes('@'), false, 'no email reaches PostHog');
  assert.equal(rows(ctx)[0].cio_sync_status, 'synced');
});

test('confirm: expired, unknown and malformed tokens are invalid_or_expired', async () => {
  const ctx = createDeps();
  await submit(ctx.deps)(post(goodBody()));
  const token = tokenFromCio(ctx);
  const h = confirm(ctx.deps);
  for (const t of ['x'.repeat(43), 'short', 123, null, undefined]) {
    assert.deepEqual(JSON.parse((await h(post({ token: t }))).body), { ok: false, reason: 'invalid_or_expired' });
  }
  ctx.clock.t += 73 * 3600 * 1000;
  assert.deepEqual(JSON.parse((await h(post({ token }))).body), { ok: false, reason: 'invalid_or_expired' });
  assert.equal(rows(ctx)[0].status, 'pending');
});

test('confirm: only POST from our origin (GET never changes state)', async () => {
  const ctx = createDeps();
  await submit(ctx.deps)(post(goodBody()));
  const token = tokenFromCio(ctx);
  const h = confirm(ctx.deps);
  assert.equal((await h({ httpMethod: 'GET', headers: {}, queryStringParameters: { token } })).statusCode, 405);
  assert.equal((await h(post({ token }, { origin: 'https://evil.example' }))).statusCode, 403);
  assert.equal(rows(ctx)[0].status, 'pending');
});

test('confirm: a rotated (resent) token invalidates the old link', async () => {
  const ctx = createDeps();
  const s = submit(ctx.deps);
  await s(post(goodBody()));
  const oldToken = tokenFromCio(ctx);
  ctx.clock.t += 61 * 60 * 1000;
  await s(post(goodBody()));
  const h = confirm(ctx.deps);
  assert.equal(JSON.parse((await h(post({ token: oldToken }))).body).ok, false);
  assert.equal(JSON.parse((await h(post({ token: tokenFromCio(ctx) }))).body).ok, true);
});

test('count: never reveals the number below the threshold', async () => {
  const ctx = createDeps();
  process.env.WAITLIST_PUBLIC_COUNT_THRESHOLD = '3';
  try {
    const h = count(ctx.deps);
    ctx.db.tables.waitlist_signups_test = [];
    const add = (n) => { for (let i = 0; i < n; i++) rows(ctx).push({ status: 'confirmed' }); };
    add(2);
    let r = await h({ httpMethod: 'GET' });
    assert.deepEqual(JSON.parse(r.body), { show: false });
    assert.equal(r.body.includes('count'), false);
    add(1);
    r = await h({ httpMethod: 'GET' });
    assert.deepEqual(JSON.parse(r.body), { show: true, count: 3 });
    assert.match(r.headers['Cache-Control'], /max-age=60/);
  } finally {
    delete process.env.WAITLIST_PUBLIC_COUNT_THRESHOLD;
  }
});

const addLink = (ctx, over = {}) => ctx.db.insertMinimal('tracked_links', {
  slug: 'tt-ep012', utm_source: 'tiktok', utm_medium: 'organic', utm_campaign: 'founder-clips',
  utm_content: 'ep-012', destination_path: '/waitlist', ...over,
});

test('go: known slug redirects with UTMs + lk; clicks are NOT logged outside production', async () => {
  const ctx = createDeps();
  await addLink(ctx);
  const res = await go(ctx.deps)({ httpMethod: 'GET', headers: { 'user-agent': 'Mozilla/5.0 Safari' }, queryStringParameters: { slug: 'tt-ep012' } });
  assert.equal(res.statusCode, 302);
  const loc = new URL(res.headers.Location, 'https://x.test');
  assert.equal(loc.pathname, '/waitlist');
  assert.equal(loc.searchParams.get('utm_source'), 'tiktok');
  assert.equal(loc.searchParams.get('utm_content'), 'ep-012');
  assert.equal(loc.searchParams.get('lk'), 'tt-ep012');
  assert.equal(ctx.db.tables.link_clicks, undefined);
});

test('go: in production, logs a click with only slug + is_bot (no IP / UA)', async () => {
  const ctx = createDeps();
  await addLink(ctx, { slug: 'ig-ep001', utm_source: 'instagram' });
  process.env.APP_ENV = 'production';
  try {
    await go(ctx.deps)({ httpMethod: 'GET', headers: { 'user-agent': 'Googlebot/2.1', 'x-nf-client-connection-ip': '1.2.3.4' }, queryStringParameters: { slug: 'ig-ep001' } });
  } finally { delete process.env.APP_ENV; }
  const c = ctx.db.tables.link_clicks;
  assert.equal(c.length, 1);
  assert.equal(c[0].slug, 'ig-ep001');
  assert.equal(c[0].is_bot, true);
  assert.equal(JSON.stringify(c).includes('1.2.3.4'), false);
  assert.equal(JSON.stringify(c).includes('Googlebot'), false);
});

test('go: unknown / malformed slugs go to "/" with no params; no open redirect via params', async () => {
  const ctx = createDeps();
  await addLink(ctx);
  const h = go(ctx.deps);
  for (const q of [{ slug: 'nope' }, { slug: '../etc' }, { slug: '' }, {}, { slug: 'tt-ep012', next: 'https://evil.example', url: 'https://evil.example' }]) {
    const res = await h({ httpMethod: 'GET', headers: {}, queryStringParameters: q });
    if (q.slug === 'tt-ep012') {
      assert.equal(new URL(res.headers.Location, 'https://x.test').host, 'x.test');
      assert.equal(res.headers.Location.includes('evil'), false);
    } else {
      assert.equal(res.headers.Location, '/');
    }
  }
});

test('go: a poisoned destination_path in the database is refused', async () => {
  const ctx = createDeps();
  await addLink(ctx, { slug: 'bad-one', destination_path: '//evil.example/x' });
  const res = await go(ctx.deps)({ httpMethod: 'GET', headers: {}, queryStringParameters: { slug: 'bad-one' } });
  assert.equal(res.headers.Location, '/');
});

test('sync-retry: inert outside production', async () => {
  const ctx = createDeps();
  const res = await retry(ctx.deps)();
  assert.match(res.body, /skipped/);
});

test('sync-retry: retries pending rows older than 2 minutes, rotates token, marks synced; gives up after 5', async () => {
  const ctx = createDeps();
  process.env.APP_ENV = 'production';
  try {
    // Production uses the production table.
    const t = ctx.db.tables;
    t.waitlist_signups = [{
      id: 'r1', email: 'a@example.com', segment: 'other', where_heard: 'search', status: 'pending',
      created_at: new Date(ctx.clock.t - 10 * 60 * 1000).toISOString(), cio_sync_status: 'pending', cio_attempts: 0,
      confirm_token_hash: 'old',
    }, {
      id: 'r2', email: 'young@example.com', segment: 'other', where_heard: 'search', status: 'pending',
      created_at: new Date(ctx.clock.t - 30 * 1000).toISOString(), cio_sync_status: 'pending', cio_attempts: 0,
    }, {
      id: 'r3', email: 'giveup@example.com', segment: 'other', where_heard: 'search', status: 'pending',
      created_at: new Date(ctx.clock.t - 10 * 60 * 1000).toISOString(), cio_sync_status: 'pending', cio_attempts: 4,
    }];
    ctx.cio.failNext = false;
    const h = retry(ctx.deps);
    const log = captureConsole();
    // First: r3 fails -> failed after 5th attempt; r1 succeeds
    const origIdentify = ctx.cio.identify;
    ctx.cio.identify = async (id, a) => { if (id === 'r3') throw new Error('x'); return origIdentify(id, a); };
    await h();
    log.restore();
    assert.equal(t.waitlist_signups[0].cio_sync_status, 'synced');
    assert.notEqual(t.waitlist_signups[0].confirm_token_hash, 'old');
    assert.equal(t.waitlist_signups[1].cio_sync_status, 'pending', 'too young to retry');
    assert.equal(t.waitlist_signups[2].cio_sync_status, 'failed');
    assert.equal(t.waitlist_signups[2].cio_attempts, 5);
  } finally { delete process.env.APP_ENV; }
});

test('preview deploys: accept their own *.netlify.app origin and build confirm links on that host', async () => {
  const ctx = createDeps();
  const host = 'deploy-preview-7--stryd.netlify.app';
  const res = await submit(ctx.deps)(post(goodBody(), { origin: `https://${host}`, headers: { host } }));
  assert.equal(res.statusCode, 200);
  const ev = ctx.cio.calls.filter((c) => c[2] === 'waitlist_submitted').pop();
  assert.ok(ev[3].confirm_url.startsWith(`https://${host}/waitlist/confirm?token=`), ev[3].confirm_url);
});

test('preview deploys: a forged Host header cannot redirect confirm links or open the origin check', async () => {
  const ctx = createDeps();
  const h = submit(ctx.deps);
  for (const host of ['evil.example', 'evil.netlify.app.evil.example', 'evil.example:443', '-bad host']) {
    const res = await h(post(goodBody(), { origin: `https://${host}`, headers: { host } }));
    assert.equal(res.statusCode, 403, host);
  }
  // Real Origin but a spoofed forwarded host: still falls back to the configured site URL for links.
  const res = await h(post(goodBody(), { origin: 'https://strydorthopedics.com', headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } }));
  assert.equal(res.statusCode, 200);
  const ev = ctx.cio.calls.filter((c) => c[2] === 'waitlist_submitted').pop();
  assert.ok(ev[3].confirm_url.startsWith('https://strydorthopedics.com/'), ev[3].confirm_url);
});

test('production never trusts the Host header or a preview origin', async () => {
  const ctx = createDeps();
  process.env.APP_ENV = 'production';
  try {
    const host = 'deploy-preview-7--stryd.netlify.app';
    const res = await submit(ctx.deps)(post(goodBody(), { origin: `https://${host}`, headers: { host } }));
    assert.equal(res.statusCode, 403);
    assert.equal((ctx.db.tables.waitlist_signups || []).length, 0);
  } finally { delete process.env.APP_ENV; }
});
