# Legal review needed before the public announcement

`/privacy` (`privacy.html`) and `/terms` (`terms.html`) are **drafts**. They were written by an AI assistant from what is actually built
(not generic boilerplate) and **they are not legal advice**. A lawyer should review both before the waitlist is announced (gate G5).

Why this matters more than usual for STRYD:

- **Youth and parents.** The waitlist targets parents of travel / high school athletes. The pages say the waitlist is 18+ only, parents sign up for themselves, and the site is not directed at children under 13. Confirm that is the right posture (COPPA and state laws on minors' data).
- **Health-adjacent positioning.** Copy deliberately frames STRYD as a wellness product, not a medical device. Have counsel confirm the wording on `/terms` and the FAQ matches the regulatory consultant's guidance, and that nothing implies diagnosis or treatment.
- **Cookies and session replay.** Analytics and session replay (inputs masked) only load after an explicit opt-in. Confirm that satisfies the rules in the jurisdictions you will market in (US state privacy laws, and GDPR/ePrivacy if you will market to the EU/UK).
- **Marketing email.** The confirmation email is transactional; the welcome and later emails are marketing. Confirm the unsubscribe and business-address requirements (CAN-SPAM) are met in the Customer.io templates (needs the mailing address from setup step H5).
- **Processors.** Netlify, Supabase, Customer.io and PostHog are named as providers. Confirm data processing terms are in place and that international transfer wording is accurate for the regions chosen.
- **Retention.** The policy says data is kept until unsubscribe/deletion and that unconfirmed signups may be deleted periodically. No automated cleanup is built; do not promise one.
- **Legacy signups.** People who joined through the old email-only form never saw this policy or the age/consent checkboxes. See the open question in the build report about re-confirming them.

When the policy changes, bump `PRIVACY_POLICY_VERSION` (`netlify/functions/lib/config.js`) **and** `POLICY_VERSION` (`assets/consent.js`) and the version line in `privacy.html`. A test enforces that all three match. Bumping it re-asks cookie consent and is stored with every new consent record.
