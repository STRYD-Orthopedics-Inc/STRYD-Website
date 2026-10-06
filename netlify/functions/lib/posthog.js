'use strict';
// Server-side PostHog events. Production only; failures are swallowed (analytics must never break signup).
// Never sends an email address (7.4): distinct id is the signup UUID.
//
// VERIFY: the $create_alias call shape against current PostHog docs. If linking proves unreliable, the Supabase
// funnel view (v_confirmation_funnel) remains the source of truth for confirmation counts.

const { isProduction } = require('./config');

async function post(payload) {
  const key = process.env.POSTHOG_PROJECT_KEY;
  const host = (process.env.POSTHOG_HOST || '').replace(/\/$/, '');
  if (!key || !host) return;
  await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, ...payload }),
  });
}

// Fire-and-forget safe wrapper.
async function captureConfirmed({ signupId, anonId, properties }) {
  if (!isProduction()) return;
  try {
    if (anonId) {
      await post({
        event: '$create_alias',
        distinct_id: anonId,
        properties: { distinct_id: anonId, alias: signupId },
      });
    }
    await post({ event: 'waitlist_confirmed', distinct_id: signupId, properties: properties || {} });
  } catch {
    // ignore
  }
}

module.exports = { captureConfirmed };
