'use strict';
// GET /go/:slug  (rewritten to /.netlify/functions/go?slug=:slug)
//
// Destinations come ONLY from the tracked_links table. No `next`/`url` parameter, so no open redirect.
// Unknown slug: 302 to "/" with no params and nothing logged.
// Non-production: redirects still work, but clicks are not logged.
// Stores no IPs or user agents (only an is_bot flag).

const { SLUG_RE } = require('./lib/validate');
const { isProduction } = require('./lib/config');
const { isBot } = require('./lib/bots');
const defaults = require('./lib/deps');

const CACHE_MS = 60 * 1000;
const cache = new Map(); // slug -> { link, at }

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    body: '',
  };
}

function createHandler(deps = defaults) {
  return async function handler(event) {
    try {
      if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') return { statusCode: 405, headers: { Allow: 'GET, HEAD' }, body: '' };

      const q = event.queryStringParameters || {};
      const slug = String(q.slug || '').trim().toLowerCase();
      if (!SLUG_RE.test(slug)) return redirect('/');

      const nowMs = deps.now();
      let hit = cache.get(slug);
      if (!hit || nowMs - hit.at > CACHE_MS) {
        const link = await deps.db.selectOne('tracked_links', { slug: `eq.${slug}` });
        hit = { link, at: nowMs };
        cache.set(slug, hit);
        if (cache.size > 500) cache.clear();
      }
      const link = hit.link;
      if (!link || !/^\/[A-Za-z0-9/_-]*$/.test(link.destination_path || '')) return redirect('/');

      if (isProduction()) {
        const ua = (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '';
        // Don't let a slow database delay the redirect.
        await Promise.race([
          deps.db.insertMinimal('link_clicks', { slug, is_bot: isBot(ua) }).catch(() => {}),
          new Promise((r) => setTimeout(r, 800)),
        ]);
      }

      const params = new URLSearchParams();
      params.set('utm_source', link.utm_source);
      params.set('utm_medium', link.utm_medium);
      if (link.utm_campaign) params.set('utm_campaign', link.utm_campaign);
      if (link.utm_content) params.set('utm_content', link.utm_content);
      params.set('lk', slug);
      return redirect(`${link.destination_path}?${params.toString()}`);
    } catch (err) {
      console.error('go error', err && err.name, err && (err.code || err.status));
      return redirect('/');
    }
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
exports._cache = cache; // tests
