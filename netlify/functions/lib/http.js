'use strict';
const { siteUrl, baseUrlFor, isProduction } = require('./config');

const MAX_BODY_BYTES = 10 * 1024;

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(statusCode, body, extraHeaders) {
  return { statusCode, headers: { ...BASE_HEADERS, ...(extraHeaders || {}) }, body: JSON.stringify(body) };
}

// Browser POSTs must come from our own origin. No open CORS.
function originAllowed(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  if (!origin) return false;
  const ok = (u) => { try { return origin === new URL(u).origin; } catch { return false; } };
  if (ok(siteUrl())) return true;
  // Production accepts only the configured site. Previews / local dev also accept their own host.
  if (!isProduction() && ok(baseUrlFor(event))) return true;
  return false;
}

// Returns { ok:true, body } or { ok:false, status, error }.
function parseJsonBody(event) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'too_large' };
  try {
    const body = JSON.parse(raw || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'bad_request' };
    return { ok: true, body };
  } catch {
    return { ok: false, status: 400, error: 'bad_request' };
  }
}

function clientIp(event) {
  const h = event.headers || {};
  const raw = h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '';
  return String(raw).split(',')[0].trim() || 'unknown';
}

module.exports = { json, originAllowed, parseJsonBody, clientIp, MAX_BODY_BYTES };
