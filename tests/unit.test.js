'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubmission, normalizeEmail, sanitizeAttribution } = require('../netlify/functions/lib/validate');
const { guessFirstName } = require('../netlify/functions/lib/firstName');
const { generateToken, hashToken, looksLikeToken } = require('../netlify/functions/lib/token');
const { isBot } = require('../netlify/functions/lib/bots');
const { buildAttributes } = require('../netlify/functions/lib/sync');

const good = () => ({
  email: 'a@b.co', segment: 'other', where_heard: 'search', age_attested: true, consent: true,
});

test('validate: accepts a minimal good submission and normalizes email', () => {
  const r = validateSubmission({ ...good(), email: '  Jordan@Example.COM ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.email, 'jordan@example.com');
  assert.equal(r.value.sport, null);
});

test('validate: requires both checkboxes to be literally true', () => {
  assert.equal(validateSubmission({ ...good(), age_attested: 'true' }).errors.age_attested, 'required');
  assert.equal(validateSubmission({ ...good(), consent: false }).errors.consent, 'required');
});

test('validate: rejects unknown fields (including a client-supplied policy version)', () => {
  const r = validateSubmission({ ...good(), consent_policy_version: 'x', admin: true });
  assert.equal(r.ok, false);
  assert.equal(r.errors.consent_policy_version, 'unknown_field');
  assert.equal(r.errors.admin, 'unknown_field');
});

test('validate: enums are enforced', () => {
  assert.equal(validateSubmission({ ...good(), segment: 'nope' }).errors.segment, 'invalid');
  assert.equal(validateSubmission({ ...good(), where_heard: 'nope' }).errors.where_heard, 'invalid');
});

test('validate: where_heard_other required only for "other"', () => {
  assert.equal(validateSubmission({ ...good(), where_heard: 'other' }).errors.where_heard_other, 'required');
  const ok = validateSubmission({ ...good(), where_heard: 'other', where_heard_other: ' a podcast ' });
  assert.equal(ok.value.where_heard_other, 'a podcast');
  const ignored = validateSubmission({ ...good(), where_heard_other: 'ignored' });
  assert.equal(ignored.value.where_heard_other, null);
});

test('validate: sport max 80, control chars stripped', () => {
  assert.equal(validateSubmission({ ...good(), sport: 'x'.repeat(81) }).errors.sport, 'too_long');
  assert.equal(validateSubmission({ ...good(), sport: 'soc\u0000cer' }).value.sport, 'soc cer');
});

test('validate: hostile email and unicode inputs', () => {
  for (const e of ['a@b', '<script>@x.co', 'a b@x.co', 'a@b.c', '', 'x'.repeat(260) + '@x.co', 'a@@b.co', '.a@x.co', 'a.@x.co', 'a..b@x.co', 'a"b@x.co']) {
    assert.equal(normalizeEmail(e), null, e);
  }
  assert.equal(normalizeEmail("O'Brien@Example.com"), "o'brien@example.com");
  assert.equal(normalizeEmail('ünï@example.com'), null); // non-ASCII local parts rejected (v1 policy)
});

test('attribution: only listed keys, sanitized; bad values dropped', () => {
  const a = sanitizeAttribution({
    utm_source: 'tiktok', utm_medium: '<b>x</b>', utm_campaign: 'founder-clips', utm_content: 'x'.repeat(200),
    lk: 'TT-ep012', landing_path: '/waitlist?utm=1#x', referrer_host: 'Example.com', evil: 'x',
  });
  assert.equal(a.utm_source, 'tiktok');
  assert.equal(a.utm_medium, null);
  assert.equal(a.utm_content, 'x'.repeat(100), 'over-long values are truncated to 100');
  assert.equal(a.link_slug, 'tt-ep012');
  assert.equal(a.landing_path, '/waitlist');
  assert.equal(a.referrer_host, 'example.com');
  assert.equal('evil' in a, false);
  assert.equal(sanitizeAttribution(null).utm_source, null);
});

test('firstName: conservative guess', () => {
  assert.equal(guessFirstName('jordan.smith@x.com'), 'Jordan');
  assert.equal(guessFirstName('MARIA_lopez22@x.com'), 'Maria');
  assert.equal(guessFirstName('info@x.com'), null);
  assert.equal(guessFirstName('contact@x.com'), null);
  assert.equal(guessFirstName('j@x.com'), null);
  assert.equal(guessFirstName('coach.mike@x.com'), null);
  assert.equal(guessFirstName('12345@x.com'), null);
  assert.equal(guessFirstName('averyveryverylongnamethatiswaytoolong@x.com'), null);
});

test('token: high entropy, hashed, shape-checked', () => {
  const a = generateToken(); const b = generateToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43);
  assert.equal(looksLikeToken(a), true);
  assert.equal(looksLikeToken('short'), false);
  assert.equal(looksLikeToken("a'; drop table--" + 'x'.repeat(30)), false);
  assert.equal(hashToken(a).length, 64);
  assert.notEqual(hashToken(a), a);
});

test('bots: empty UA and known crawlers are bots', () => {
  assert.equal(isBot(''), true);
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
  assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1'), false);
});

test('sync: attributes use unix times, omit nulls, never "first_name"', () => {
  const a = buildAttributes({
    email: 'a@b.co', segment: 'other', sport: null, where_heard: 'search', status: 'pending',
    first_name_guess: 'Jordan', created_at: '2026-10-06T12:00:00Z', confirmed_at: null,
  });
  assert.equal(a.created_at, Math.floor(Date.parse('2026-10-06T12:00:00Z') / 1000));
  assert.equal('sport' in a, false);
  assert.equal(a.confirmed, false);
  assert.equal(a.first_name_guess, 'Jordan');
  assert.equal('first_name' in a, false);
  assert.equal(a.is_test, true); // APP_ENV is not production in tests
});
