'use strict';
// Conservative first-name guess from the email local part. Greeting only.
// Never stored as `first_name` anywhere (it is a guess).

const DENYLIST = new Set([
  'info', 'contact', 'hello', 'hi', 'hey', 'admin', 'team', 'sales', 'support', 'mail', 'email', 'office',
  'coach', 'sports', 'sport', 'athletics', 'training', 'fitness', 'noreply', 'no', 'reply', 'help', 'service',
  'billing', 'hr', 'jobs', 'press', 'media', 'marketing', 'webmaster', 'postmaster', 'test', 'user', 'name',
  'club', 'school', 'staff', 'general', 'enquiries', 'inquiries', 'orders', 'booking', 'bookings', 'me',
]);

function guessFirstName(email) {
  const local = String(email || '').split('@')[0] || '';
  const first = local.split(/[._\-+\d]+/).filter(Boolean)[0] || '';
  if (!/^\p{L}{2,20}$/u.test(first)) return null;
  if (DENYLIST.has(first.toLowerCase())) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

module.exports = { guessFirstName };
