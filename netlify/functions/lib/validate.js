'use strict';
// Server-side validation + sanitising for the waitlist submit endpoint.
// Pure functions: no I/O.

const SEGMENTS = ['parent_travel_hs', 'runner_active_adult', 'pro_college_athlete', 'other'];
const WHERE_HEARD = ['tiktok', 'instagram', 'youtube', 'linkedin', 'x', 'friend_referral', 'event_flyer', 'search', 'other'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

const TOP_LEVEL_KEYS = new Set([
  'email', 'segment', 'sport', 'where_heard', 'where_heard_other',
  'age_attested', 'consent', 'attribution', 'posthog_distinct_id', 'hp',
]);
const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'lk', 'landing_path', 'referrer_host'];

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(CONTROL_RE, ' ').trim().slice(0, max);
}

function normalizeEmail(v) {
  const e = String(v == null ? '' : v).trim().toLowerCase();
  if (!e || e.length > 254) return null;
  // ASCII "atext" local part (apostrophes are valid, e.g. o'brien@), no leading/trailing/double dots;
  // plain ASCII hostname. Non-ASCII addresses are rejected in v1.
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(e)) return null;
  const local = e.split('@')[0];
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  return e;
}

// Attribution values are untrusted: letters, digits, ._~- and spaces only, max 100.
function cleanAttr(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, 100);
  return /^[A-Za-z0-9._~\- ]{1,100}$/.test(t) ? t : null;
}

function cleanPath(v) {
  if (typeof v !== 'string') return null;
  const p = v.split(/[?#]/)[0].slice(0, 100);
  return /^\/[A-Za-z0-9/_.\-]*$/.test(p) ? p : null;
}

function cleanHost(v) {
  if (typeof v !== 'string') return null;
  const h = v.trim().toLowerCase().slice(0, 100);
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) ? h : null;
}

function cleanDistinctId(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, 200);
  return /^[A-Za-z0-9_\-:.$]{1,200}$/.test(t) ? t : null;
}

function sanitizeAttribution(a) {
  const out = {
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    link_slug: null, landing_path: null, referrer_host: null,
  };
  if (!a || typeof a !== 'object' || Array.isArray(a)) return out;
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) out[k] = cleanAttr(a[k]);
  const lk = typeof a.lk === 'string' ? a.lk.trim().toLowerCase() : '';
  out.link_slug = SLUG_RE.test(lk) ? lk : null;
  out.landing_path = cleanPath(a.landing_path);
  out.referrer_host = cleanHost(a.referrer_host);
  return out;
}

// Returns { ok:true, value } or { ok:false, errors:{ field: code } }.
function validateSubmission(body) {
  const errors = {};
  for (const k of Object.keys(body)) {
    if (!TOP_LEVEL_KEYS.has(k)) errors[k] = 'unknown_field';
  }

  const email = normalizeEmail(body.email);
  if (!email) errors.email = 'invalid';

  const segment = typeof body.segment === 'string' ? body.segment : '';
  if (!SEGMENTS.includes(segment)) errors.segment = 'invalid';

  const whereHeard = typeof body.where_heard === 'string' ? body.where_heard : '';
  if (!WHERE_HEARD.includes(whereHeard)) errors.where_heard = 'invalid';

  let whereOther = null;
  if (whereHeard === 'other') {
    whereOther = cleanText(body.where_heard_other, 120);
    if (!whereOther) errors.where_heard_other = 'required';
  }

  let sport = null;
  if (body.sport != null && body.sport !== '') {
    if (typeof body.sport !== 'string') errors.sport = 'invalid';
    else {
      if (body.sport.trim().length > 80) errors.sport = 'too_long';
      sport = cleanText(body.sport, 80) || null;
    }
  }

  if (body.age_attested !== true) errors.age_attested = 'required';
  if (body.consent !== true) errors.consent = 'required';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      email,
      segment,
      sport,
      where_heard: whereHeard,
      where_heard_other: whereOther,
      attribution: sanitizeAttribution(body.attribution),
      posthog_distinct_id: cleanDistinctId(body.posthog_distinct_id),
    },
  };
}

module.exports = {
  SEGMENTS, WHERE_HEARD, SLUG_RE,
  validateSubmission, normalizeEmail, sanitizeAttribution, cleanAttr, cleanPath, cleanHost,
};
