# Waitlist setup

Stack: Netlify (site + functions), Supabase (source of truth), Customer.io (email), PostHog (analytics).
Nothing here needs a build step. The site is static HTML; the waitlist backend is the functions in `netlify/functions/`.

## Human steps (Saketh)

| # | Step | Notes |
|---|---|---|
| H1 | Create the Supabase project `stryd-waitlist` | Sign in with GitHub as **SakethKanumuriSO**. Note the region. Keep the project URL and the **service role key** private (never in chat, never committed). |
| H2 | Create the PostHog project | Note the region (US or EU) and the **project API key** (public key, starts `phc_`). If EU, change the two `/ingest` redirects in `netlify.toml` (see the comment there). |
| H3 | Customer.io | **Sending domain `mail.strydorthopedics.com` is added** and its MX, SPF and DKIM records are live on `cio165392.mail.strydorthopedics.com` (checked in public DNS); click **Verify** in Customer.io until it shows verified. The root domain's SPF/DMARC are untouched (HubSpot and Microsoft 365 also send from the root); the existing root DMARC (`p=quarantine`, relaxed alignment) already covers the subdomain. Remaining: create the **Track API key** (site ID + API key, **Settings > Account Settings > API Credentials**), set the Netlify variables, and build the automations from `docs/customerio-emails.md`. |
| H4 | Confirm the `contact@` mailbox exists, receives mail, and someone watches replies | Replies from the welcome email land here. |
| H5 | ~~Provide the business mailing address~~ **Done:** STRYD Orthopedics, Inc., 811 5th Ave N, Birmingham, AL 35203 | Required in the footer of marketing email (welcome email draft includes it). |
| H6 | Add the env vars below in Netlify | UI: Site configuration > Environment variables. Use per-context values. |
| H7 | Approve at the gates | G1 plan (done), G2 preview, G3 email copy, G4 merge, G5 security sweep. |

> The Customer.io **MCP connection is for Claude's tooling only**. The deployed function cannot use it. It needs the API credentials from H3 as env vars.

## Environment variables

Set these in the **Netlify UI / CLI**, not in `netlify.toml`: values in `netlify.toml` are build-time only and are **not visible to functions at runtime**.
Scope each variable to the right deploy contexts (Production / Deploy Previews / Branch deploys).

| Name | Secret | Production | Previews | Notes |
|---|---|---|---|---|
| `APP_ENV` | no | `production` | `preview` (any value other than `production`) | **Only** the literal `production` enables production behavior. Anything else = writes to `*_test` tables, no real email, PostHog off. |
| `SITE_URL` | no | `https://strydorthopedics.com` | **leave unset** | Production only. Previews derive their own `*.netlify.app` host from the request (Netlify's `CONTEXT`/`DEPLOY_URL`/`DEPLOY_PRIME_URL` are build-time only and not visible to functions). Used to build confirm links and to check the `Origin` header. |
| `SUPABASE_URL` | no | from H1 | same project | |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | from H1 | same | Server only. Mark as secret + scope to Functions. |
| `CUSTOMERIO_SITE_ID` | **yes** | from H3 | set only if you want previews to send to allow-listed team addresses | |
| `CUSTOMERIO_API_KEY` | **yes** | from H3 | same | |
| `CUSTOMERIO_REGION` | no | `us` or `eu` | same | |
| `CUSTOMERIO_TRACK_BASE` | no | optional override | | Normally unset. The default `https://track.customer.io/api/v1` (EU: `track-eu`) was confirmed against Customer.io (401 without credentials). |
| `SENDER_EMAIL` | no | `contact@mail.strydorthopedics.com` | | Informational; the sender is configured in Customer.io. A from-address must end in `@mail.strydorthopedics.com`; reply-to is `contact@strydorthopedics.com`. |
| `POSTHOG_PROJECT_KEY` | no | from H2 | leave unset | Public key. Returned to the browser by `/api/config` **only in production**. |
| `POSTHOG_HOST` | no | e.g. `https://us.i.posthog.com` | leave unset | Used by the server for `waitlist_confirmed` events and to derive the UI host. |
| `WAITLIST_PUBLIC_COUNT_THRESHOLD` | no | `1000` | `1000` | The counter stays hidden below this many **confirmed** signups. |
| `CONFIRM_TOKEN_TTL_HOURS` | no | `72` | `72` | |
| `RATE_LIMIT_SALT` | **yes** | any long random string | any | Salts the IP hash used for rate limiting. |
| `PREVIEW_EMAIL_ALLOWLIST` | no | leave unset | optional: comma-separated **team** addresses | Lets a preview send real Customer.io mail to those addresses only (profiles tagged `is_test`). Everyone else is log-only. |

## Database (Supabase)

Run in order in the Supabase SQL editor (or `supabase db push` if you adopt the CLI):

1. `supabase/migrations/0001_waitlist_tables.sql` (tables, RLS on, no policies, privileges revoked from `anon`/`authenticated`)
2. `supabase/migrations/0002_rate_limit.sql`
3. `supabase/migrations/0003_reporting_views.sql` (9 aggregate views, none expose email)
4. `supabase/seed/tracked_links.sql` (example tracked links; edit slugs before launch)

`waitlist_targets` ships with the roadmap's **placeholder** pace targets. Review them before relying on `v_progress_vs_target`.

Quick check that the public API cannot read anything (replace with your project values; the anon key is the public one from Project Settings > API):

```bash
curl -s "$SUPABASE_URL/rest/v1/waitlist_signups?select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# expect an error / empty, never rows. Repeat for waitlist_signups_test, tracked_links, link_clicks, rate_limit_events, waitlist_targets and each v_* view.
```

## Tracked links

`/go/<slug>` looks the slug up in `tracked_links` and 302s to `destination_path` with UTMs and `lk=<slug>`.
Convention: slug = `{platform}-{episode}` (e.g. `tt-ep012`). `utm_source` must be one of `tiktok`, `instagram`, `youtube`, `linkedin`, `x` so it lines up with the self-reported "where did you hear about us" answers. `utm_medium` = `organic`. `utm_content` unique per post.

```sql
insert into tracked_links (slug, utm_source, utm_medium, utm_campaign, utm_content, destination_path)
values ('tt-ep013', 'tiktok', 'organic', 'founder-clips', 'ep-013', '/waitlist');
```

Clicks are logged only in production, with only `slug` and an `is_bot` flag (no IP, no user agent).

## Running locally (no accounts needed)

```bash
node scripts/dev-server.js --mock    # http://localhost:8123 ; in-memory DB ; confirm links print in the terminal
npm test                             # unit + handler + static tests
```

`node scripts/dev-server.js` (without `--mock`) uses the real functions and needs `SUPABASE_*` in your shell. With `APP_ENV` unset it only touches the `*_test` tables.

## Deploy order

Feature branch -> preview deploy (**G2**) -> email copy approved (**G3**) -> merge approval (**G4**) -> production deploy -> smoke test with team addresses -> security sweep (**G5**) -> announce.
DNS verification for the sending domain must be complete before the production email test.

## Existing early-access signups

The old homepage form stored signups in **Netlify Forms** (dashboard export). They did not go through double opt-in or the age/consent checkboxes, so they should not be imported as confirmed. Decision pending (see the build report).
