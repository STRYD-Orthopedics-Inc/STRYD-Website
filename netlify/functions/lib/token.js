'use strict';
const crypto = require('crypto');

// 32 random bytes, URL-safe. Only the SHA-256 hash is stored.
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Shape check before we hit the database.
function looksLikeToken(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t);
}

module.exports = { generateToken, hashToken, looksLikeToken };
