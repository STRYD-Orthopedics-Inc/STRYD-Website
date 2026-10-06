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
  return json(
    200,
    { analytics, posthogKey: analytics ? key : null, uiHost: analytics ? uiHostFor(host) : null, policyVersion: PRIVACY_POLICY_VERSION },
    { 'Cache-Control': 'public, max-age=300' },
  );
}

exports.handler = handler;
