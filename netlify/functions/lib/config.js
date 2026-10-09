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

// Configured site URL (set SITE_URL on the Production context). Netlify's CONTEXT / DEPLOY_URL / DEPLOY_PRIME_URL
// are build-time only and are NOT visible to functions, so previews cannot rely on them (see baseUrlFor).
function siteUrl() {
  const u = process.env.SITE_URL || process.env.URL || 'https://strydorthopedics.com';
  return u.replace(/\/$/, '');
}

// Base URL for links we generate and the origin we accept.
// Production: always the configured site URL (the Host header is never trusted).
// Non-production (deploy previews, local dev): the request's own host, but only if it is a *.netlify.app or
// localhost host, so a forged Host header cannot point confirm links at an attacker's domain.
function baseUrlFor(event) {
  if (isProduction()) return siteUrl();
  const h = (event && event.headers) || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/.test(host)) return siteUrl();
  const hostname = host.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `http://${host}`;
  if (hostname.endsWith('.netlify.app')) return `https://${host}`;
  return siteUrl();
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

module.exports = { PRIVACY_POLICY_VERSION, isProduction, siteUrl, baseUrlFor, signupsTable, confirmTtlMs, countThreshold };
