'use strict';
// Minimal Supabase (PostgREST) client over fetch, using the service role key.
// No npm dependency. Errors carry only status + Postgres code, never the response
// body (which can echo submitted values such as email addresses).

class DbError extends Error {
  constructor(status, code) {
    super('db_error');
    this.name = 'DbError';
    this.status = status;
    this.code = code || '';
  }
}

function cfg() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DbError(0, 'not_configured');
  return { url: url.replace(/\/$/, '') + '/rest/v1', key };
}

async function request(method, table, { query, body, prefer } = {}) {
  const { url, key } = cfg();
  const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/${table}${qs}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let code = '';
    try { code = (await res.json()).code || ''; } catch { /* ignore */ }
    throw new DbError(res.status, code);
  }
  return res;
}

// filters: { column: 'eq.value' | 'lt.value' | ... }
async function selectMany(table, filters, { columns = '*', order, limit } = {}) {
  const query = { ...(filters || {}), select: columns };
  if (order) query.order = order;
  if (limit) query.limit = String(limit);
  const res = await request('GET', table, { query });
  return res.json();
}

async function selectOne(table, filters, columns = '*') {
  const rows = await selectMany(table, filters, { columns, limit: 1 });
  return rows[0] || null;
}

async function insert(table, row) {
  const res = await request('POST', table, { body: row, prefer: 'return=representation' });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function insertMinimal(table, row) {
  await request('POST', table, { body: row, prefer: 'return=minimal' });
}

async function update(table, filters, patch) {
  await request('PATCH', table, { query: filters, body: patch, prefer: 'return=minimal' });
}

async function remove(table, filters) {
  await request('DELETE', table, { query: filters, prefer: 'return=minimal' });
}

async function count(table, filters) {
  const res = await request('HEAD', table, { query: { ...(filters || {}), select: 'id' }, prefer: 'count=exact' });
  const range = res.headers.get('content-range') || '';
  const n = Number(range.split('/')[1]);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { DbError, selectMany, selectOne, insert, insertMinimal, update, remove, count };
