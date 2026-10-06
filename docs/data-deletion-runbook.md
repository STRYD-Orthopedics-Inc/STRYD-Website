# Data deletion runbook

Use when someone asks to be deleted ("delete my data", "remove me") by emailing contact@strydorthopedics.com.
Delete the person from **all three systems**, then confirm. Do not paste the person's email into chats, tickets or logs.

Systems that hold a waitlist signup: **Supabase** (source of truth), **Customer.io** (email profile), **PostHog** (analytics, only if they accepted cookies).
Also check: the `contact@` mailbox (their emails/replies) and **Netlify Forms** (only if they used the "Get in Touch" contact form).

## 0. Verify the request

Reply from contact@ to the address that wrote in. If you're unsure it's really them, ask them to reply from the signup address.

## 1. Look up the record (Supabase SQL editor)

```sql
select id, posthog_distinct_id, status, created_at
from public.waitlist_signups
where lower(email) = lower('PERSON@EXAMPLE.COM');
```

Write down `id` (this is also the Customer.io person id and the PostHog identified id) and `posthog_distinct_id` (their anonymous PostHog id). Previews write to `waitlist_signups_test`; run the same query there if the signup might have come from a preview.

## 2. Delete in Customer.io

Customer.io: People > search by the `id` from step 1 (or the email) > open the person > **Delete**.
(API alternative with the Track API credentials: `DELETE https://track.customer.io/api/v1/customers/<id>`, site ID + API key as basic auth; use `track-eu` for the EU region.)
Confirm the search returns nothing.

## 3. Delete in PostHog

Only needed if they ever accepted cookies (i.e. `posthog_distinct_id` is not null, or they were identified).
PostHog: Persons > search by the signup `id` (identified) and by `posthog_distinct_id` (anonymous) > open each > **Delete person** (choose to delete the person's events and recordings too).
Check Session replay for any recording linked to those ids and delete it.

## 4. Delete in Supabase (last, so you still had the ids)

```sql
delete from public.waitlist_signups where id = 'ID-FROM-STEP-1';
-- and, if it exists there:
delete from public.waitlist_signups_test where lower(email) = lower('PERSON@EXAMPLE.COM');
```

Aggregate counts and `link_clicks` are anonymous and do not need deleting.

## 5. Other places

- **contact@ mailbox**: search for the address; delete threads you are not required to keep.
- **Netlify Forms** (contact-form submissions): Netlify dashboard > Forms > `contact` > delete the submission(s).

## 6. Confirm it is done

- [ ] Supabase query from step 1 returns no rows (both tables)
- [ ] Customer.io search returns nothing
- [ ] PostHog persons search returns nothing for both ids
- [ ] Reply to the requester confirming deletion (no personal details beyond "your information has been deleted")
- [ ] Log the request date and completion date (no email address, no name) in the team's request log
