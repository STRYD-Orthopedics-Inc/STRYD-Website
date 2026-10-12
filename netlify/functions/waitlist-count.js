'use strict';
// GET /api/waitlist/count
// Returns { show:false } below the threshold. The number is NEVER sent below the threshold.
const { json } = require('./lib/http');
const { signupsTable, countThreshold } = require('./lib/config');
const defaults = require('./lib/deps');

function createHandler(deps = defaults) {
  return async function handler(event) {
    try {
      if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET' });
      const n = await deps.db.count(signupsTable(), { status: 'eq.confirmed' });
      const cache = { 'Cache-Control': 'public, max-age=60' };
      if (n < countThreshold()) return json(200, { show: false }, cache);
      return json(200, { show: true, count: n }, cache);
    } catch (err) {
      console.error('count error', err && err.name, err && (err.code || err.status));
      return json(200, { show: false }, { 'Cache-Control': 'no-store' });
    }
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
