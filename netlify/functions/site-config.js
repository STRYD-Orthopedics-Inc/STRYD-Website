'use strict';
// GET /api/config
// The site is static (no build step), so the browser cannot read env vars. This returns the PUBLIC analytics
// settings. In non-production it reports analytics:false, which keeps PostHog fully off on previews (decision 11).
// Only public values are returned: the PostHog project key is a public write-only key by design.
const { json } = require('./lib/http');
const { isProduction, PRIVACY_POLICY_VERSION } = require('./lib/config');

function uiHostFor(apiHost) {
  // https://us.i.posthog.com -> https://us.posthog.com
  try {
    const u = new URL(apiHost);
    return `${u.protocol}//${u.hostname.replace('.i.posthog.com', '.posthog.com')}`;
  } catch {
    return 'https://us.posthog.com';
  }
}

async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET' });
  const key = process.env.POSTHOG_PROJECT_KEY || '';
  const host = process.env.POSTHOG_HOST || '';
  const analytics = isProduction() && !!key && !!host;
  const body = { analytics, posthogKey: analytics ? key : null, uiHost: analytics ? uiHostFor(host) : null, policyVersion: PRIVACY_POLICY_VERSION };
  // Previews / local only: yes-no flags about the server env, never values, so setup problems are visible without
  // dashboard logs. Never included in production.
  if (!isProduction()) {
    const sbUrl = process.env.SUPABASE_URL || '';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    body.envCheck = {
      app_env: process.env.APP_ENV || null,
      supabase_url_set: !!sbUrl,
      supabase_url_looks_right: /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(sbUrl),
      service_key_set: !!sbKey,
      service_key_looks_like_legacy_jwt: /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(sbKey),
      rate_limit_salt_set: !!process.env.RATE_LIMIT_SALT,
      customerio_set: !!(process.env.CUSTOMERIO_SITE_ID && process.env.CUSTOMERIO_API_KEY),
    };
  }
  return json(200, body, { 'Cache-Control': isProduction() ? 'public, max-age=300' : 'no-store' });
}

exports.handler = handler;
