'use strict';
// Supabase-backed rate limiter keyed by a salted hash of the IP (raw IPs are never stored).
const crypto = require('crypto');

const TABLE = 'rate_limit_events';

// Defaults from the handoff: 5 / 10 min and 30 / hour per IP.
const SUBMIT_LIMITS = [
  { windowMs: 10 * 60 * 1000, max: 5 },
  { windowMs: 60 * 60 * 1000, max: 30 },
];
const CONFIRM_LIMITS = [
  { windowMs: 10 * 60 * 1000, max: 30 },
];

function ipHash(ip, bucket) {
  const salt = process.env.RATE_LIMIT_SALT || 'stryd-waitlist';
  return crypto.createHash('sha256').update(`${salt}|${bucket}|${ip}`).digest('hex');
}

// Returns true if the request is allowed (and records it), false if over the limit.
async function allow(db, ip, bucket, limits, nowMs = Date.now()) {
  const h = ipHash(ip, bucket);
  for (const { windowMs, max } of limits) {
    const n = await db.count(TABLE, {
      ip_hash: `eq.${h}`,
      hit_at: `gte.${new Date(nowMs - windowMs).toISOString()}`,
    });
    if (n >= max) return false;
  }
  await db.insertMinimal(TABLE, { ip_hash: h });
  return true;
}

async function cleanup(db, nowMs = Date.now()) {
  await db.remove(TABLE, { hit_at: `lt.${new Date(nowMs - 2 * 3600 * 1000).toISOString()}` });
}

module.exports = { allow, cleanup, SUBMIT_LIMITS, CONFIRM_LIMITS, ipHash };
