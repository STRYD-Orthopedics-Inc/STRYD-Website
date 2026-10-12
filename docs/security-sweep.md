# Security sweep (gate G5)

Run **after the production deploy**, before the waitlist is announced. Fill in the results column and give the table to Saketh.

## Automated part

```bash
# production: read-only checks (no signups written)
node scripts/security-sweep.js https://strydorthopedics.com

# production smoke test with a TEAM-OWNED address (writes a real signup and sends the real confirmation email)
node scripts/security-sweep.js https://strydorthopedics.com --allow-writes --email you@your-team-domain.com
```

It checks: security headers (CSP, HSTS, nosniff, referrer policy, permissions policy, framing), origin/method/size/JSON handling, unknown fields, honeypot,
hostile input in every field and attribution value, duplicate-submit responses (no email enumeration), the confirm endpoint (GET never confirms, bad tokens),
the counter shape, `/go` redirects (no open redirect), no keys in public files, no PostHog before consent, and (with `--allow-writes`) the rate limit.
The rate-limit test runs last and locks the sweeping IP out for about 10 minutes.

## Manual part

| Check | How | Result |
|---|---|---|
| RLS: anon key cannot read any table or view | curl commands in `docs/setup.md` (each table and each `v_*` view) | |
| Service role key not in client bundle, repo or history | `git log -p --all -S"service_role"`; `git grep -n "eyJ" $(git rev-list --all)`; open the deployed JS in the browser and search | |
| Secrets only in Netlify env vars | Netlify UI: secrets scoped to Functions; nothing in `netlify.toml` | |
| Environment isolation | On a preview deploy: submit; confirm the row is in `waitlist_signups_test`, no real email arrives, no PostHog requests | |
| Token handling | Confirm link in a real email: token is removed from the address bar; token does not appear in PostHog events/URLs, Netlify logs, or referrers | |
| PostHog privacy | DevTools Network: zero `/ingest` requests before clicking Accept; after Accept, replay shows inputs masked; no email in any event | |
| Logs | Netlify function logs: no emails, tokens, or request bodies | |
| Email authentication | View headers of a received test message: SPF, DKIM, DMARC all `pass` | |
| Dependencies | `npm audit` (project has no npm dependencies today) | |
| Supabase linter | Supabase dashboard > Advisors: review warnings about definer views (the `v_*` views have access revoked from `anon`/`authenticated`) | |
