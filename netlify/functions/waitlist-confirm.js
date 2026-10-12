'use strict';
// POST /api/waitlist/confirm  { token }
//
// Must be a POST fired by JavaScript on the confirm page (never a state-changing GET): email security
// scanners prefetch links and would otherwise confirm people automatically.
// Idempotent: repeat clicks return { ok:true, already:true }.

const { json, originAllowed, parseJsonBody, clientIp } = require('./lib/http');
const { signupsTable } = require('./lib/config');
const { hashToken, looksLikeToken } = require('./lib/token');
const { sendConfirmed } = require('./lib/sync');
const defaults = require('./lib/deps');

function createHandler(deps = defaults) {
  const { db, cio, ph, rate } = deps;

  return async function handler(event) {
    try {
      if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
      if (!originAllowed(event)) return json(403, { ok: false, error: 'forbidden' });

      const parsed = parseJsonBody(event);
      if (!parsed.ok) return json(parsed.status, { ok: false, error: parsed.error });

      const allowed = await rate.allow(db, clientIp(event), 'confirm', rate.CONFIRM_LIMITS, deps.now());
      if (!allowed) return json(429, { ok: false, error: 'rate_limited' });

      const token = parsed.body.token;
      const invalid = json(200, { ok: false, reason: 'invalid_or_expired' });
      if (!looksLikeToken(token)) return invalid;

      const table = signupsTable();
      const row = await db.selectOne(table, { confirm_token_hash: `eq.${hashToken(token)}` });
      if (!row) return invalid;
      if (row.status === 'confirmed') return json(200, { ok: true, already: true });

      const nowMs = deps.now();
      if (!row.confirm_token_expires_at || new Date(row.confirm_token_expires_at).getTime() < nowMs) return invalid;

      const confirmedAt = new Date(nowMs).toISOString();
      // cio_sync_status goes back to pending until the confirmed update reaches Customer.io.
      await db.update(table, { id: `eq.${row.id}`, status: 'eq.pending' }, {
        status: 'confirmed',
        confirmed_at: confirmedAt,
        cio_sync_status: 'pending',
      });
      const confirmedRow = { ...row, status: 'confirmed', confirmed_at: confirmedAt };

      try {
        await sendConfirmed(cio, confirmedRow);
        await db.update(table, { id: `eq.${row.id}` }, { cio_sync_status: 'synced' });
      } catch (err) {
        console.error('confirm cio sync failed', err && err.name, err && err.status);
        try {
          await db.update(table, { id: `eq.${row.id}` }, { cio_attempts: (row.cio_attempts || 0) + 1 });
        } catch { /* ignore */ }
      }

      await ph.captureConfirmed({
        signupId: row.id,
        anonId: row.posthog_distinct_id,
        properties: {
          segment: row.segment,
          where_heard: row.where_heard,
          hours_to_confirm: Math.round(((nowMs - new Date(row.created_at).getTime()) / 3600000) * 100) / 100,
        },
      });

      return json(200, { ok: true });
    } catch (err) {
      console.error('confirm error', err && err.name, err && (err.code || err.status));
      return json(500, { ok: false, error: 'server_error' });
    }
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
