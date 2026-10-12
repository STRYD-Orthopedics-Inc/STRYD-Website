'use strict';
// Customer.io Track API client (HTTP basic auth: site ID + API key).
//
// VERIFY BEFORE PRODUCTION (handoff H3 / 4.2): confirm the workspace uses the Track API (not Data Pipelines),
// its region, and the exact base URL below against current Customer.io docs. The base can be overridden with
// CUSTOMERIO_TRACK_BASE without a code change.
//
// The MCP connection is for tooling only; the deployed function uses these env vars:
//   CUSTOMERIO_SITE_ID, CUSTOMERIO_API_KEY, CUSTOMERIO_REGION ('us' | 'eu')

const { isProduction } = require('./config');

class CioError extends Error {
  constructor(status) {
    super('cio_error');
    this.name = 'CioError';
    this.status = status;
  }
}

function base() {
  if (process.env.CUSTOMERIO_TRACK_BASE) return process.env.CUSTOMERIO_TRACK_BASE.replace(/\/$/, '');
  const eu = String(process.env.CUSTOMERIO_REGION || 'us').toLowerCase() === 'eu';
  return (eu ? 'https://track-eu.customer.io' : 'https://track.customer.io') + '/api/v1';
}

async function call(method, path, body) {
  const site = process.env.CUSTOMERIO_SITE_ID;
  const key = process.env.CUSTOMERIO_API_KEY;
  if (!site || !key) throw new CioError(0);
  const res = await fetch(base() + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${site}:${key}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new CioError(res.status);
}

function identify(id, attributes) {
  return call('PUT', `/customers/${encodeURIComponent(id)}`, attributes);
}

function track(id, name, data) {
  return call('POST', `/customers/${encodeURIComponent(id)}/events`, { name, data: data || {} });
}

// Production sends. Non-production only sends for allow-listed team addresses (6.8); everything
// else is "log": the caller logs what would have been sent and makes no Customer.io call.
function mode(email) {
  if (isProduction()) return 'send';
  const allow = String(process.env.PREVIEW_EMAIL_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(String(email || '').toLowerCase()) ? 'send' : 'log';
}

module.exports = { identify, track, mode, CioError };
