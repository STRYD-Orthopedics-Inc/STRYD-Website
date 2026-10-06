'use strict';
// Customer.io sync for waitlist signups: attribute mapping + the two events.
const { siteUrl, isProduction } = require('./config');

const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);

// Customer.io expects unix timestamps for dates. Null/undefined attributes are omitted.
// Do NOT name this `first_name`: it is only a guess.
function buildAttributes(row) {
  const a = {
    email: row.email,
    segment: row.segment,
    sport: row.sport,
    where_heard: row.where_heard,
    where_heard_other: row.where_heard_other,
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_content: row.utm_content,
    link_slug: row.link_slug,
    first_name_guess: row.first_name_guess,
    confirmed: row.status === 'confirmed',
    created_at: row.created_at ? unix(row.created_at) : undefined,
    confirmed_at: row.confirmed_at ? unix(row.confirmed_at) : undefined,
  };
  if (!isProduction()) a.is_test = true;
  for (const k of Object.keys(a)) if (a[k] == null) delete a[k];
  return a;
}

// Returns 'synced' | 'skipped'. Throws on Customer.io failure.
async function sendSubmitted(cio, row, token) {
  if (cio.mode(row.email) === 'log') {
    console.log('[cio:log-only] would identify person and track waitlist_submitted');
    return 'skipped';
  }
  const confirmUrl = `${siteUrl()}/waitlist/confirm?token=${token}`;
  await cio.identify(row.id, buildAttributes(row));
  await cio.track(row.id, 'waitlist_submitted', { confirm_url: confirmUrl });
  return 'synced';
}

async function sendConfirmed(cio, row) {
  if (cio.mode(row.email) === 'log') {
    console.log('[cio:log-only] would update person and track waitlist_confirmed');
    return 'skipped';
  }
  await cio.identify(row.id, buildAttributes(row));
  await cio.track(row.id, 'waitlist_confirmed', {});
  return 'synced';
}

module.exports = { buildAttributes, sendSubmitted, sendConfirmed };
