'use strict';
// Simple user-agent bot check for tracked-link clicks. Empty UA counts as a bot.
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python-requests|httpclient|headless|monitor|scanner/i;

function isBot(userAgent) {
  const ua = String(userAgent || '').trim();
  return !ua || BOT_RE.test(ua);
}

module.exports = { isBot };
