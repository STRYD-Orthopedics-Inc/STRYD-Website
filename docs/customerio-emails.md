# Customer.io: automations, segments, and email drafts

**Status: DRAFT. Do not activate anything until Saketh approves the copy (gate G3).**
Keep every email step in draft and send no test to a real person's address until the sending domain shows verified.
Language rules apply to every email: casual and founder-written; no "prevent / detect / diagnose / treat"; no competitor names; no efficacy or medical claims;
no pricing, tier or free-trial mentions; no dates; do not lean on "gait analysis". Footer on every marketing email: unsubscribe link + physical address.

## Workspace facts (as of Oct 15, 2026)

- Workspace `234601`, account `165392`, Startup plan.
- Sending domain **`mail.strydorthopedics.com`** (Customer.io records live on `cio165392.mail.strydorthopedics.com`; the root domain's records are untouched because HubSpot and Microsoft 365 also send from the root). Public DNS shows the MX, SPF and DKIM records resolving. The root `_dmarc` (`p=quarantine; adkim=r; aspf=r`) already covers it through relaxed alignment. **Do not edit root SPF or DMARC.**
- **From:** `STRYD <contact@mail.strydorthopedics.com>` (a from-address must end in `@mail.strydorthopedics.com`). **Reply-to:** `contact@strydorthopedics.com`. Set reply-to on every email.
- Mailing address for footers: STRYD Orthopedics, Inc., 811 5th Ave N, Birmingham, AL 35203.

## How this maps to what the site already sends

The handoff for this setup proposed some names that differ from what is built and tested. The site's contract wins, because the signup form, Supabase, PostHog and the deletion runbook all depend on it.

| Handoff proposed | What the site actually sends | Why |
|---|---|---|
| Trigger welcome on `waitlist_joined` | **`waitlist_submitted`** (confirmation email) then **`waitlist_confirmed`** (welcome sequence) | Double opt-in (decision 5): nobody who hasn't clicked the confirm link may receive marketing email. |
| Person id = email | Person id = **signup UUID** (also the Supabase row id and PostHog id) | Links the three systems; lets the deletion runbook find a person without searching by email. |
| `segment` = `hs_athlete` / `active_adult` | `parent_travel_hs`, `runner_active_adult`, `pro_college_athlete`, `other` | These are the four options on the form. |
| `signup_source` | `where_heard` (+ `where_heard_other`) and the UTM attributes | Self-reported source, kept next to the tracked one. |

Attributes on every person: `email`, `segment`, `sport`, `where_heard`, `where_heard_other`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `link_slug`, `first_name_guess`, `confirmed` (boolean), `created_at`, `confirmed_at` (unix timestamps), `is_test` (previews only).
`first_name_guess` is only a guess: always use it with a no-name fallback.
Events: `waitlist_submitted` (data: `confirm_url`), `waitlist_confirmed`.

## Automation 1: "Waitlist: confirm email"  (transactional, event-triggered)

- Trigger: event `waitlist_submitted`. Send immediately. Allow re-entry (a resend after the cooldown fires a new event).
- Turn **off click tracking** on this email so the confirm link stays the direct URL.
- It is the only message unconfirmed people ever receive.

**Subject:** confirm your email for STRYD

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

## Automation 2: "Waitlist Welcome"  (event-triggered, 4 emails)

- Trigger: event **`waitlist_confirmed`**. Condition `confirmed is true` as a safety net.
- Exit: the person enters the **Unsubscribed** segment. Respect unsubscribes; add a subscription topic if the workspace has one.
- Cadence: email 1 immediately, email 2 after 2 days, email 3 after 3 more days (day 5), email 4 after 5 more days (day 10).
- Build in Design Studio; reply-to `contact@strydorthopedics.com`; every email ends with the footer block below.
- The nurture sequence is marketing email. Nothing here is a promise about availability, features or price.

**Footer on every email in this automation**

```
{% unsubscribe_url %}  (Unsubscribe)
STRYD Orthopedics, Inc. | 811 5th Ave N, Birmingham, AL 35203
```

### Email 1 (immediately): welcome

**Subject:** you're on the list

```
{% if customer.first_name_guess %}Hi {{ customer.first_name_guess }},{% else %}Hi there,{% endif %}

You're in. Thanks for joining the STRYD waitlist.

STRYD is a wearable sleeve and app for your knees. Knees take a lot of small hits over time, and most of us only think about them once something already hurts. We're building STRYD so you can see how they're doing as you go.

What to expect: an email every so often while we build. Short, and never spammy. You can unsubscribe whenever you like.

You can hit reply any time. It comes straight to us and we read everything.

Saketh, Ashton, and Aldo
STRYD Orthopedics
```

### Email 2 (day 2): the three things we track

**Subject:** the three numbers we care about

```
{% if customer.first_name_guess %}Hi {{ customer.first_name_guess }},{% else %}Hi there,{% endif %}

Quick one on what the STRYD app is built around. Three simple reads, always shown together:

Knee health: a plain-language read on how your knees are holding up.
Strain: how much load they've been taking lately.
Micro trauma: the small, everyday stresses that quietly add up over weeks and months.

Each one comes with a sentence in normal words, so you're not left squinting at a chart.

We're still fine-tuning how each of these is worked out, so what you see at launch may look a little different from how we describe it here. We'll keep you posted as it comes together.

Saketh, Ashton, and Aldo
STRYD Orthopedics
```

### Email 3 (day 5): one question

**Subject:** a quick question

```
{% if customer.first_name_guess %}Hi {{ customer.first_name_guess }},{% else %}Hi there,{% endif %}

One question, and you can answer in a line or two: what's the one thing you'd most like to understand about your knees?

Are you running, playing a sport, or keeping up with an athlete in your family? Tell us a little about that too if you feel like it. Your answers shape what we build first.

Just hit reply. A real person reads every one.

Saketh, Ashton, and Aldo
STRYD Orthopedics
```

### Email 4 (day 10): pass it on

**Subject:** know someone who'd want this?

```
{% if customer.first_name_guess %}Hi {{ customer.first_name_guess }},{% else %}Hi there,{% endif %}

If a teammate, a running buddy, or another sports parent comes to mind, you're welcome to point them to strydorthopedics.com. There's no code or form. We'd just be glad to have them on the list.

Thanks for being here early. We'll keep sharing what we learn as we build.

Saketh, Ashton, and Aldo
STRYD Orthopedics
```

> No referral incentive exists, and there is no referral-code system (out of scope for this iteration). Do not mention rewards or tracked links.

## Segments to create

| Segment | Condition |
|---|---|
| Waitlist: confirmed | attribute `confirmed` is true (or has performed `waitlist_confirmed`) |
| Waitlist: pending | attribute `confirmed` is false |
| Waitlist: parent_travel_hs | `segment` = `parent_travel_hs` |
| Waitlist: runner_active_adult | `segment` = `runner_active_adult` |
| Waitlist: pro_college_athlete | `segment` = `pro_college_athlete` |
| Waitlist: other | `segment` = `other` |
| Engaged | opened or clicked any waitlist email in the last 30 days |

## Testing (team addresses only)

1. `node scripts/customerio-check.js` registers the two event names and a test profile (needs `.env.local`; see the script header). Keep the automations in draft while you do this.
2. Use Customer.io's test send for each email, to a team address, only after the domain shows **verified**. Check rendering in Gmail and Outlook and where it lands (inbox vs spam).
3. On a preview deploy, set `PREVIEW_EMAIL_ALLOWLIST` to team addresses, submit the form with one of them, and confirm: the confirmation email arrives, the link works, the welcome email arrives, and the Supabase `*_test` row is right.
4. Verify SPF, DKIM and DMARC all `pass` in the headers of a received message.
5. Only then flip the emails to automatic. Watch the first 50 signups (bounces, spam complaints, opens). It is a new sending domain, so keep volume organic and ramp slowly.
