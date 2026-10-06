#!/usr/bin/env node
'use strict';
// Tiny local dev server: static files + the Netlify rewrites from netlify.toml + the functions.
//   node scripts/dev-server.js           -> real functions (needs SUPABASE_* env vars; APP_ENV unset = *_test tables)
//   node scripts/dev-server.js --mock    -> in-memory database + fake Customer.io. No accounts or keys needed.
//                                           Confirm links are printed to this terminal instead of emailed.
// Not used in production.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8123);
const MOCK = process.argv.includes('--mock');

let deps;
if (MOCK) {
  const { createDeps } = require('../tests/helpers');
  const ctx = createDeps();
  ctx.clock.now = () => Date.now();
  ctx.deps.now = () => Date.now();
  const track = ctx.cio.track;
  ctx.cio.track = async (id, name, data) => {
    await track(id, name, data);
    if (name === 'waitlist_submitted') console.log('\n[mock email] confirm link:\n  ' + data.confirm_url.replace(/^https?:\/\/[^/]+/, `http://localhost:${PORT}`) + '\n');
  };
  deps = ctx.deps;
  // Seed a tracked link so /go/tt-ep012 works in mock mode.
  ctx.db.insertMinimal('tracked_links', { slug: 'tt-ep012', utm_source: 'tiktok', utm_medium: 'organic', utm_campaign: 'founder-clips', utm_content: 'ep-012', destination_path: '/waitlist' });
  console.log('MOCK MODE: in-memory data, no emails sent.');
}

function fn(name) {
  const m = require(`../netlify/functions/${name}`);
  return MOCK && m.createHandler ? m.createHandler(deps) : m.handler;
}

const API = {
  '/api/waitlist': 'waitlist',
  '/api/waitlist/confirm': 'waitlist-confirm',
  '/api/waitlist/count': 'waitlist-count',
  '/api/config': 'site-config',
};
const PAGES = {
  '/waitlist': 'waitlist.html',
  '/waitlist/check-email': 'waitlist-check-email.html',
  '/waitlist/confirm': 'waitlist-confirm.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.json': 'application/json',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function runFunction(handler, req, res, query) {
  const body = await readBody(req);
  const event = { httpMethod: req.method, headers: req.headers, body, queryStringParameters: query, isBase64Encoded: false };
  const out = await handler(event);
  res.writeHead(out.statusCode || 200, out.headers || {});
  res.end(out.body || '');
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let p = url.pathname.replace(/\/+$/, '') || '/';

    if (API[p]) return runFunction(fn(API[p]), req, res, Object.fromEntries(url.searchParams));
    const g = p.match(/^\/go\/([^/]+)$/);
    if (g) return runFunction(fn('go'), req, res, { slug: g[1] });
    if (p === '/') p = '/index.html';
    if (PAGES[p]) p = '/' + PAGES[p];

    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error('dev-server error', err.message);
    res.writeHead(500);
    res.end('error');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
