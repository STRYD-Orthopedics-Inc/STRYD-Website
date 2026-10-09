'use strict';
// Test doubles: in-memory fake of lib/db.js, fake Customer.io / PostHog, and a controllable clock.
const crypto = require('crypto');
const { DbError } = require('../netlify/functions/lib/db');
const realRate = require('../netlify/functions/lib/rateLimit');

function matches(row, key, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const v = row[key];
  const num = (x) => (typeof x === 'number' ? x : Number(x));
  const cmp = (a, b) => (!Number.isNaN(num(a)) && !Number.isNaN(num(b)) && typeof a === 'number' ? num(a) - num(b) : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  switch (op) {
    case 'eq': return String(v) === raw;
    case 'lt': return v != null && cmp(v, raw) < 0;
    case 'gte': return v != null && cmp(v, raw) >= 0;
    default: throw new Error('unsupported op ' + op);
  }
}

function createFakeDb(clock) {
  const tables = {};
  const t = (n) => (tables[n] = tables[n] || []);
  const nowIso = () => new Date(clock.now()).toISOString();
  const filter = (rows, filters) => rows.filter((r) => Object.entries(filters || {}).every(([k, e]) => matches(r, k, e)));

  return {
    tables,
    async selectMany(table, filters, { limit } = {}) {
      const rows = filter(t(table), filters).map((r) => ({ ...r }));
      return limit ? rows.slice(0, limit) : rows;
    },
    async selectOne(table, filters) {
      const r = filter(t(table), filters)[0];
      return r ? { ...r } : null;
    },
    async insert(table, row) {
      if (table.startsWith('waitlist_signups') && t(table).some((r) => r.email.toLowerCase() === row.email.toLowerCase())) {
        throw new DbError(409, '23505');
      }
      const full = { id: crypto.randomUUID(), created_at: nowIso(), status: 'pending', confirmed_at: null, cio_sync_status: 'pending', cio_attempts: 0, ...row };
      t(table).push(full);
      return { ...full };
    },
    async insertMinimal(table, row) {
      t(table).push({ id: t(table).length + 1, hit_at: nowIso(), clicked_at: nowIso(), ...row });
    },
    async update(table, filters, patch) {
      filter(t(table), filters).forEach((r) => Object.assign(r, patch));
    },
    async remove(table, filters) {
      const del = new Set(filter(t(table), filters));
      tables[table] = t(table).filter((r) => !del.has(r));
    },
    async count(table, filters) {
      return filter(t(table), filters).length;
    },
  };
}

function createDeps({ production = false } = {}) {
  const clock = { t: Date.parse('2026-10-06T12:00:00Z'), now() { return this.t; } };
  const db = createFakeDb(clock);
  const calls = [];
  const cio = {
    calls,
    failNext: false,
    forceMode: null,
    mode: (email) => (cio.forceMode ? cio.forceMode : 'send'),
    async identify(id, attrs) { if (cio.failNext) throw new Error('cio down'); calls.push(['identify', id, attrs]); },
    async track(id, name, data) { if (cio.failNext) throw new Error('cio down'); calls.push(['track', id, name, data]); },
  };
  const phCalls = [];
  const ph = { calls: phCalls, async captureConfirmed(x) { phCalls.push(x); } };
  const deps = { db, cio, ph, rate: realRate, now: () => clock.now() };
  return { deps, clock, db, cio, ph };
}

function post(body, { origin = 'https://strydorthopedics.com', ip = '203.0.113.7', raw, headers = {} } = {}) {
  return {
    httpMethod: 'POST',
    headers: { origin, 'x-nf-client-connection-ip': ip, ...headers },
    body: raw !== undefined ? raw : JSON.stringify(body),
  };
}

const goodBody = (over = {}) => ({
  email: 'Jordan.Smith@Example.com',
  segment: 'runner_active_adult',
  where_heard: 'tiktok',
  age_attested: true,
  consent: true,
  ...over,
});

// Capture console output so tests can assert nothing sensitive is logged.
function captureConsole() {
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  return { lines, restore() { console.log = orig.log; console.error = orig.error; } };
}

module.exports = { createDeps, post, goodBody, captureConsole };
