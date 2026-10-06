'use strict';
// Scheduled every 15 minutes (see netlify.toml). Netlify only runs scheduled functions on the published
// (production) deploy; the guard below keeps it inert anywhere else.
//
// - Pending signups whose Customer.io sync is pending: rotate the token and retry identify + waitlist_submitted.
// - Confirmed signups whose confirmed update did not reach Customer.io: retry that update.
// - After 5 failed attempts the row is marked `failed` and surfaces in the logs / v_ views.
// - Also prunes old rate-limit events.

const { isProduction, signupsTable, confirmTtlMs } = require('./lib/config');
const { generateToken, hashToken } = require('./lib/token');
const { sendSubmitted, sendConfirmed } = require('./lib/sync');
const defaults = require('./lib/deps');

const MAX_ATTEMPTS = 5;

function createHandler(deps = defaults) {
  const { db, cio, rate } = deps;

  return async function handler() {
    if (!isProduction()) return { statusCode: 200, body: 'skipped (non-production)' };
    const table = signupsTable();
    const nowMs = deps.now();
    const cutoff = new Date(nowMs - 2 * 60 * 1000).toISOString();
    let retried = 0, synced = 0, failed = 0;

    try { await rate.cleanup(db, nowMs); } catch (err) { console.error('rate cleanup failed', err && err.name); }

    const rows = await db.selectMany(
      table,
      { cio_sync_status: 'eq.pending', cio_attempts: `lt.${MAX_ATTEMPTS}`, created_at: `lt.${cutoff}` },
      { limit: 100, order: 'created_at.asc' },
    );

    for (const row of rows) {
      retried += 1;
      try {
        if (row.status === 'confirmed') {
          await sendConfirmed(cio, row);
        } else {
          const token = generateToken();
          await db.update(table, { id: `eq.${row.id}` }, {
            confirm_token_hash: hashToken(token),
            confirm_token_expires_at: new Date(nowMs + confirmTtlMs()).toISOString(),
            confirm_email_sent_at: new Date(nowMs).toISOString(),
          });
          await sendSubmitted(cio, row, token);
        }
        await db.update(table, { id: `eq.${row.id}` }, { cio_sync_status: 'synced' });
        synced += 1;
      } catch (err) {
        failed += 1;
        const attempts = (row.cio_attempts || 0) + 1;
        console.error('sync retry failed', err && err.name, err && err.status);
        try {
          await db.update(table, { id: `eq.${row.id}` }, {
            cio_attempts: attempts,
            cio_sync_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          });
        } catch { /* ignore */ }
      }
    }

    const permanentlyFailed = await db.count(table, { cio_sync_status: 'eq.failed' });
    console.log(`sync-retry: retried=${retried} synced=${synced} failed=${failed} permanently_failed=${permanentlyFailed}`);
    return { statusCode: 200, body: JSON.stringify({ retried, synced, failed, permanentlyFailed }) };
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
