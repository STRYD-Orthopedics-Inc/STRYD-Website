#!/usr/bin/env node
'use strict';
// Customer.io connection check. Uses the SAME client code as the deployed functions (netlify/functions/lib/customerio.js).
//
//   1. Create a file named .env.local in the project root (it is git-ignored) containing:
//        CUSTOMERIO_SITE_ID=...
//        CUSTOMERIO_API_KEY=...
//        CUSTOMERIO_REGION=us            (or eu)
//        CHECK_EMAIL=you@your-team-domain.com     (a team-owned address; it becomes a test profile)
//   2. Run:  node scripts/customerio-check.js            -> creates/updates the test profile and sends both events
//            node scripts/customerio-check.js --cleanup  -> also deletes the test profile at the end
//
// It prints status codes only, never your keys. Sending the two events is also what makes the event names appear in
// Customer.io's campaign trigger picker (a campaign can only trigger on an event name it has already seen).
// The campaigns must be left in DRAFT while you test, otherwise the events will email CHECK_EMAIL.

const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envFile)) {
  console.error('No .env.local found in the project root. See the instructions at the top of scripts/customerio-check.js');
  process.exit(2);
}
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const need = ['CUSTOMERIO_SITE_ID', 'CUSTOMERIO_API_KEY', 'CHECK_EMAIL'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error('Missing in .env.local: ' + missing.join(', ')); process.exit(2); }
if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(process.env.CHECK_EMAIL)) { console.error('CHECK_EMAIL is not a valid address'); process.exit(2); }
process.env.APP_ENV = 'production';   // so mode() === 'send' (this script is explicit and manual)

const cio = require('../netlify/functions/lib/customerio');
const { buildAttributes } = require('../netlify/functions/lib/sync');

const ID = 'cio-check-team-profile';
const region = String(process.env.CUSTOMERIO_REGION || 'us').toLowerCase();

async function step(label, fn) {
  try { await fn(); console.log('PASS  ' + label); return true; }
  catch (e) {
    const hint = e && e.status === 401 ? ' (wrong Site ID / API key, or the key is for a different region)'
      : e && e.status === 404 ? ' (unexpected: check CUSTOMERIO_REGION)' : e && e.status === 0 ? ' (missing credentials)' : '';
    console.log('FAIL  ' + label + '  [HTTP ' + (e && e.status) + ']' + hint);
    return false;
  }
}

(async () => {
  console.log(`Customer.io check: region=${region}, base=${process.env.CUSTOMERIO_TRACK_BASE || (region === 'eu' ? 'track-eu' : 'track') + '.customer.io/api/v1'}`);
  const row = {
    id: ID, email: process.env.CHECK_EMAIL.trim().toLowerCase(), segment: 'other', where_heard: 'search', sport: null,
    status: 'pending', first_name_guess: 'Sam', created_at: new Date().toISOString(),
  };
  let ok = true;
  ok = (await step('identify test profile (PUT /customers)', () => cio.identify(ID, buildAttributes(row)))) && ok;
  ok = (await step('event waitlist_submitted (POST /customers/{id}/events)', () => cio.track(ID, 'waitlist_submitted', { confirm_url: 'https://strydorthopedics.com/waitlist/confirm?token=TEST-NOT-A-REAL-TOKEN' }))) && ok;
  ok = (await step('update profile as confirmed', () => cio.identify(ID, buildAttributes({ ...row, status: 'confirmed', confirmed_at: new Date().toISOString() })))) && ok;
  ok = (await step('event waitlist_confirmed', () => cio.track(ID, 'waitlist_confirmed', {}))) && ok;

  if (process.argv.includes('--cleanup')) {
    const site = process.env.CUSTOMERIO_SITE_ID, key = process.env.CUSTOMERIO_API_KEY;
    const base = process.env.CUSTOMERIO_TRACK_BASE || (region === 'eu' ? 'https://track-eu.customer.io/api/v1' : 'https://track.customer.io/api/v1');
    ok = (await step('delete the test profile', async () => {
      const res = await fetch(`${base}/customers/${encodeURIComponent(ID)}`, { method: 'DELETE', headers: { Authorization: 'Basic ' + Buffer.from(`${site}:${key}`).toString('base64') } });
      if (!res.ok) { const e = new Error('x'); e.status = res.status; throw e; }
    })) && ok;
  } else {
    console.log('Test profile kept (id ' + ID + '). Re-run with --cleanup to delete it when you are done.');
  }
  console.log(ok ? '\nAll good: the site can talk to your Customer.io workspace.' : '\nSomething failed; see the FAIL lines above.');
  process.exit(ok ? 0 : 1);
})();
