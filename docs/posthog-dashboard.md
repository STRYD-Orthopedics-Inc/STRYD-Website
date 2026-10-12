# PostHog dashboard: "Waitlist Overview"

Click-by-click, because PostHog API/MCP access is not available in the build environment.
Do this after the first production visits with cookies accepted, so the events exist to pick from.

New dashboard: **Dashboards > New dashboard > "Waitlist Overview"**, then add these insights (**Add insight** > New):

| # | Insight | Type | Setup |
|---|---|---|---|
| 1 | Waitlist funnel | Funnel | Step 1: `$pageview` where **Path name** = `/waitlist`. Step 2: `waitlist_form_started`. Step 3: `waitlist_form_submitted`. Step 4: `waitlist_confirmed`. Conversion window 14 days. (`waitlist_confirmed` is sent by the server and linked to the visitor via alias; if the linking looks unreliable, trust the Supabase view `v_confirmation_funnel` for confirmation counts.) |
| 2a | Signups by UTM source | Trends | Event `waitlist_form_submitted`, breakdown **Initial UTM source** (`$initial_utm_source`). |
| 2b | Signups by where heard | Trends | Event `waitlist_form_submitted`, breakdown event property `where_heard`. |
| 3 | Landing page to submit | Funnel | Step 1: `$pageview` (any). Step 2: `waitlist_form_submitted`. Breakdown by **Entry path name** (`$entry_pathname`). |
| 4 | CTA clicks by location | Trends | Event `cta_click`, breakdown `location`. |
| 5a | Video play rate | Trends | Event `video_played`, breakdown `video_id`. **Note:** the hero video autoplays muted, so `video_played` fires for nearly every visitor who loads the page. Treat it as "video started", not as intent. |
| 5c | Sleeve viewer use | Trends | Event `hero_viewer_used`, breakdown `method`; compare to `$pageview` on `/` to get the share of visitors who interact. |
| 5b | Video progress | Trends | Event `video_progress`, breakdown `percent`, filtered to `video_id` = `hero_demo`. |
| 6 | Form errors | Trends | Event `waitlist_form_error`, breakdown `error_type`. |
| 7 | Theme split | Trends | Event `$pageview`, breakdown `theme` (registered as a super property). |

Events the site sends (all snake_case): `$pageview`, `$pageleave`, `cta_click {location,label,destination}`, `waitlist_form_started {first_field}`, `waitlist_form_submitted {segment,where_heard,has_sport}`, `waitlist_form_error {error_type,fields}`, `waitlist_confirmed {segment,where_heard,hours_to_confirm}` (server), `video_played {video_id}`, `video_progress {video_id,percent}`, `hero_viewer_used {method}` (first time a visitor drags / pinches / uses the keyboard on the sleeve viewer; `method` is `pointer`, `wheel` or `keyboard`), `faq_opened {question_id}`.

Privacy settings to confirm in the PostHog project: session replay **on**, "Mask all inputs" on (the site also sets it in code), and the email input carries `ph-no-capture`. No email address is ever sent to PostHog.
