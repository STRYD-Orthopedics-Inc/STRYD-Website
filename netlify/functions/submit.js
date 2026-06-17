'use strict';
// ============================================================
//  STRYD Orthopedics — Form submission handler
//  Netlify Function: /.netlify/functions/submit
//
//  Responsibilities:
//    1. Honeypot bot detection
//    2. Server-side input validation & sanitisation
//    3. IP-based rate limiting (per form, per IP)
//    4. Forward to Netlify Forms so submissions appear in dashboard
// ============================================================

// --------------- In-memory rate-limit store -----------------
// Keyed by "formName:ip". Serverless instances don't share state,
// but this still blocks repeated rapid submissions per warm instance.
const _rl = Object.create(null);

function serverRateLimit(key) {
  const now = Date.now();
  const WIN = 60 * 60 * 1000; // 1-hour rolling window
  const MAX = 5;               // max submissions per window
  _rl[key] = (_rl[key] || []).filter(t => now - t < WIN);
  if (_rl[key].length >= MAX) return false;
  _rl[key].push(now);
  return true;
}

// --------------- Helpers ------------------------------------
function sanitize(val, maxLen = 500) {
  return String(val ?? '').trim().slice(0, maxLen);
}

function validEmail(val) {
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(String(val ?? ''));
}

// --------------- Handler ------------------------------------
exports.handler = async (event) => {
  const SITE_URL = (process.env.URL || 'https://strydorthopedics.com').replace(/\/$/, '');

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': SITE_URL,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Parse URL-encoded body
  let params;
  try { params = new URLSearchParams(event.body || ''); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Malformed request' }) }; }

  const formName = params.get('form-name') || '';

  // Honeypot — silently accept so bots don't know they were blocked
  if (params.get('website')) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // Allow-list form names
  if (!['contact', 'waitlist'].includes(formName)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown form.' }) };
  }

  // IP-based server-side rate limit
  const ip = (
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for'] ||
    'unknown'
  ).split(',')[0].trim();

  if (!serverRateLimit(`${formName}:${ip}`)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Too many submissions — please wait before trying again.' }),
    };
  }

  // Validate & sanitise fields
  const email = sanitize(params.get('email'), 254);
  if (!validEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  if (formName === 'contact') {
    const firstName = sanitize(params.get('firstName'), 100);
    const lastName  = sanitize(params.get('lastName'),  100);
    const message   = sanitize(params.get('message'),  2000);
    const role      = sanitize(params.get('role'),       50);
    const validRoles = ['clinician', 'patient', 'investor', 'partner', 'researcher', 'other'];

    if (!firstName || !lastName) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'First and last name are required.' }) };
    }
    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'A message is required.' }) };
    }
    if (!validRoles.includes(role)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please select your role.' }) };
    }
  }

  // Validation passed — return success.
  // The client will then POST directly to '/' so Netlify stores the submission
  // as a verified entry in the dashboard (server-to-server POSTs are flagged unverified).
  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};
