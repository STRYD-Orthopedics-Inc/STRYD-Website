'use strict';
// Shared configuration helpers. All env access goes through here so the
// production / non-production split (decision 11) lives in one place.

// Bump whenever privacy.html changes. Stored with every consent record.
// Never accepted from the client.
const PRIVACY_POLICY_VERSION = '2026-10-06';

// Fail safe: anything other than the literal string "production" is non-production.
function isProduction() {
  return process.env.APP_ENV === 'production';
}

function siteUrl() {
  const u = process.env.SITE_URL || process.env.DEPLOY_PRIME_URL || 'https://strydorthopedics.com';
  return u.replace(/\/$/, '');
}

// Previews and local dev write to the _test table.
function signupsTable() {
  return isProduction() ? 'waitlist_signups' : 'waitlist_signups_test';
}

function confirmTtlMs() {
  const h = Number(process.env.CONFIRM_TOKEN_TTL_HOURS || 72);
  return (Number.isFinite(h) && h > 0 ? h : 72) * 3600 * 1000;
}

function countThreshold() {
  const n = Number(process.env.WAITLIST_PUBLIC_COUNT_THRESHOLD || 1000);
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

module.exports = { PRIVACY_POLICY_VERSION, isProduction, siteUrl, signupsTable, confirmTtlMs, countThreshold };
