# Customer.io: campaigns, segments, and email drafts

**Status: DRAFT. Do not activate either campaign until Saketh approves the copy (gate G3).**
The Customer.io MCP is not connected in the build environment, so these are written as click-by-click setup steps and copy, not created for you.
Language rules apply here too: no clinical or efficacy wording, no competitor names, no dates or prices.

## Data the site sends

Person id = the signup UUID. Attributes: `email`, `segment`, `sport`, `where_heard`, `where_heard_other`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `link_slug`, `first_name_guess`, `confirmed` (boolean), `created_at`, `confirmed_at` (unix timestamps), `is_test` (previews only).
Events: `waitlist_submitted` (data: `confirm_url`), `waitlist_confirmed`.
`first_name_guess` is only a guess. Always use it with a no-name fallback (examples below).

## Campaign 1: "Waitlist: confirm email"  (event-triggered, transactional)

- Trigger: event `waitlist_submitted`. Send immediately. Allow re-entry (a resend after the cooldown fires a new event).
- From: `STRYD <contact@strydorthopedics.com>`   Reply-to: `contact@strydorthopedics.com`
- Turn **off click tracking** for this email if supported, so the confirm link is the direct URL.
- Only one email, no other messages should go to unconfirmed people.

**Subject:** Confirm your email for STRYD

**HTML/plain body:**

```
{% if customer.first_name_guess %}Hi {{ customer.first_name_guess }},{% else %}Hi there,{% endif %}

Thanks for joining the STRYD waitlist. Tap the button below to confirm your email and lock in your spot.

[ Confirm my email ]   -> {{ event.confirm_url }}

This link expires in 72 hours. If you didn't sign up, you can ignore this email and nothing will happen.

The STRYD team
```

Plain-text version:

```
{% if customer.first_name_guess %}Hi {{ customer.first_name_guess }},{% else %}Hi there,{% endif %}

Thanks for joining the STRYD waitlist. Open this link to confirm your email and lock in your spot:

{{ event.confirm_url }}

This link expires in 72 hours. If you didn't sign up, you can ignore this email and nothing will happen.

The STRYD team
```

## Campaign 2: "Waitlist: welcome"  (event-triggered)

- Trigger: event `waitlist_confirmed`. Send immediately. Add a condition `confirmed is true` as a safety net.
- From / reply-to as above. Include the **unsubscribe link** and the **business mailing address** (setup step H5).

**Subject:** You're on the STRYD waitlist

```
{% if customer.first_name_guess %}Hi {{ customer.first_name_guess }},{% else %}Hi there,{% endif %}

You're in. STRYD is the wearable for knee health, and we're glad you're here early.

What to expect: occasional updates as we build, roughly once a month. Nothing pushy.

One question: what's the one thing you'd most like to understand about your knees? Just hit reply. We read every one.

Saketh, Ashton, and Aldo
STRYD Orthopedics

[unsubscribe link]  [business mailing address]
```

## Segments to create

| Segment | Condition |
|---|---|
| Waitlist: confirmed | attribute `confirmed` is true |
| Waitlist: pending | attribute `confirmed` is false |
| Waitlist: parent_travel_hs | `segment` = `parent_travel_hs` |
| Waitlist: runner_active_adult | `segment` = `runner_active_adult` |
| Waitlist: pro_college_athlete | `segment` = `pro_college_athlete` |
| Waitlist: other | `segment` = `other` |

Engagement and "hot" segments come later.

## Testing (team addresses only)

1. Use Customer.io's test send for each campaign to a team address.
2. On a preview deploy, set `PREVIEW_EMAIL_ALLOWLIST` to team addresses, submit the form with one of them, and confirm: the email arrives, the link works, the welcome email arrives, the Supabase `*_test` row is right.
3. Check the first preview run against Customer.io's current API docs: the Track API base URL (`CUSTOMERIO_TRACK_BASE`) was not confirmable from the docs alone.
4. Verify SPF, DKIM and DMARC pass on a received test message (view the message headers).
