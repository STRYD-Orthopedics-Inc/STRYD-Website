'use strict';
// POST /api/waitlist  (submit)
//
// - Honeypot, origin check, size limit, rate limit, server-side validation.
// - Double opt-in: stores only the SHA-256 hash of the confirm token.
// - Identical 200 response for new / pending / confirmed emails (no enumeration).
// - Non-production: writes to waitlist_signups_test; Customer.io is log-only (see lib/customerio.js mode()).
// - Never logs emails, tokens, or request bodies.

const { json, originAllowed, parseJsonBody, clientIp } = require('./lib/http');
const { PRIVACY_POLICY_VERSION, signupsTable, confirmTtlMs } = require('./lib/config');
const { validateSubmission } = require('./lib/validate');
const { generateToken, hashToken } = require('./lib/token');
const { guessFirstName } = require('./lib/firstName');
const { sendSubmitted } = require('./lib/sync');
const defaults = require('./lib/deps');

const RESEND_COOLDOWN_MS = 60 * 60 * 1000;
const OK = { ok: true };

function createHandler(deps = defaults) {
  const { db, cio, rate } = deps;

  // Customer.io sync for a pending signup. Never throws: failures are retried by sync-retry.
  async function syncPending(table, row, token) {
    try {
      await sendSubmitted(cio, row, token);
      await db.update(table, { id: `eq.${row.id}` }, { cio_sync_status: 'synced' });
    } catch (err) {
      console.error('waitlist cio sync failed', err && err.name, err && err.status);
      try {
        await db.update(table, { id: `eq.${row.id}` }, { cio_attempts: (row.cio_attempts || 0) + 1 });
      } catch { /* ignore */ }
    }
  }

  return async function handler(event) {
    try {
      if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
      if (!originAllowed(event)) return json(403, { ok: false, error: 'forbidden' });

      const parsed = parseJsonBody(event);
      if (!parsed.ok) return json(parsed.status, { ok: false, error: parsed.error });
      const body = parsed.body;

      // Honeypot: pretend success, do nothing.
      if (body.hp != null && String(body.hp) !== '') return json(200, OK);

      const allowed = await rate.allow(db, clientIp(event), 'submit', rate.SUBMIT_LIMITS, deps.now());
      if (!allowed) return json(429, { ok: false, error: 'rate_limited' });

      const result = validateSubmission(body);
      if (!result.ok) return json(400, { ok: false, errors: result.errors });
      const v = result.value;

      const table = signupsTable();
      const nowMs = deps.now();
      const nowIso = new Date(nowMs).toISOString();
      const existing = await db.selectOne(table, { email: `eq.${v.email}` });

      if (!existing) {
        const token = generateToken();
        const row = {
          email: v.email,
          first_name_guess: guessFirstName(v.email),
          segment: v.segment,
          sport: v.sport,
          where_heard: v.where_heard,
          where_heard_other: v.where_heard_other,
          status: 'pending',
          confirm_token_hash: hashToken(token),
          confirm_token_expires_at: new Date(nowMs + confirmTtlMs()).toISOString(),
          confirm_email_sent_at: nowIso,
          age_attested: true,
          consent_at: nowIso,
          consent_policy_version: PRIVACY_POLICY_VERSION,
          utm_source: v.attribution.utm_source,
          utm_medium: v.attribution.utm_medium,
          utm_campaign: v.attribution.utm_campaign,
          utm_content: v.attribution.utm_content,
          utm_term: v.attribution.utm_term,
          link_slug: v.attribution.link_slug,
          referrer_host: v.attribution.referrer_host,
          landing_path: v.attribution.landing_path,
          posthog_distinct_id: v.posthog_distinct_id,
          cio_sync_status: 'pending',
          cio_attempts: 0,
        };
        let inserted;
        try {
          inserted = await db.insert(table, row);
        } catch (err) {
          // Unique violation = lost a race with a concurrent identical submit. Treat as already present.
          if (err && err.code === '23505') return json(200, OK);
          throw err;
        }
        await syncPending(table, inserted, token);
      } else if (existing.status === 'pending') {
        const sentAt = existing.confirm_email_sent_at ? new Date(existing.confirm_email_sent_at).getTime() : 0;
        if (nowMs - sentAt > RESEND_COOLDOWN_MS) {
          const token = generateToken();
          await db.update(table, { id: `eq.${existing.id}` }, {
            confirm_token_hash: hashToken(token),
            confirm_token_expires_at: new Date(nowMs + confirmTtlMs()).toISOString(),
            confirm_email_sent_at: nowIso,
          });
          await syncPending(table, existing, token);
        }
      }
      // confirmed: do nothing

      return json(200, OK);
    } catch (err) {
      console.error('waitlist error', err && err.name, err && (err.code || err.status));
      return json(500, { ok: false, error: 'server_error' });
    }
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
