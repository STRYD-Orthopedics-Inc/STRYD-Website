-- Aggregate-only reporting views. None expose email addresses.
-- Access is revoked from anon/authenticated so they cannot be read through the public API.
-- Grant select to a dedicated reporting role later (e.g. when Metabase is added).

create view public.v_waitlist_totals as
select
  count(*) as submitted,
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'confirmed') as confirmed
from public.waitlist_signups;

-- Grouped by the day the signup was submitted; "confirmed" counts those signups that are now confirmed.
create view public.v_signups_daily as
select
  (created_at at time zone 'utc')::date as day,
  count(*) as submitted,
  count(*) filter (where status = 'confirmed') as confirmed
from public.waitlist_signups
group by 1
order by 1;

create view public.v_signups_by_segment as
select
  segment,
  count(*) as submitted,
  count(*) filter (where status = 'confirmed') as confirmed
from public.waitlist_signups
group by 1
order by 2 desc;

create view public.v_signups_by_tracked_source as
select
  coalesce(utm_source,   '(none)') as utm_source,
  coalesce(utm_medium,   '(none)') as utm_medium,
  coalesce(utm_campaign, '(none)') as utm_campaign,
  coalesce(link_slug,    '(none)') as link_slug,
  count(*) as submitted,
  count(*) filter (where status = 'confirmed') as confirmed
from public.waitlist_signups
group by 1,2,3,4
order by 5 desc;

create view public.v_signups_by_self_reported as
select
  where_heard,
  count(*) as submitted,
  count(*) filter (where status = 'confirmed') as confirmed
from public.waitlist_signups
group by 1
order by 2 desc;

-- Self-reported vs tracked source, confirmed signups only.
create view public.v_attribution_compare as
select
  where_heard,
  coalesce(utm_source, '(none)') as utm_source,
  count(*) as confirmed
from public.waitlist_signups
where status = 'confirmed'
group by 1,2
order by 3 desc;

create view public.v_confirmation_funnel as
select
  segment,
  count(*) as submitted,
  count(*) filter (where status = 'confirmed') as confirmed,
  round(100.0 * count(*) filter (where status = 'confirmed') / nullif(count(*),0), 1) as confirmation_rate_pct,
  round((percentile_cont(0.5) within group (
    order by extract(epoch from (confirmed_at - created_at)) / 3600.0
  ) filter (where status = 'confirmed'))::numeric, 2) as median_hours_to_confirm
from public.waitlist_signups
group by 1
order by 2 desc;

create view public.v_link_performance as
with clicks as (
  select slug, count(*) as clicks from public.link_clicks where not is_bot group by slug
), signups as (
  select link_slug as slug,
         count(*) as submitted,
         count(*) filter (where status = 'confirmed') as confirmed
  from public.waitlist_signups where link_slug is not null group by link_slug
)
select
  l.slug,
  coalesce(c.clicks, 0)    as clicks,
  coalesce(s.submitted, 0) as submitted,
  coalesce(s.confirmed, 0) as confirmed,
  round(100.0 * coalesce(s.submitted, 0) / nullif(c.clicks, 0), 1) as signup_rate_pct
from public.tracked_links l
left join clicks  c on c.slug = l.slug
left join signups s on s.slug = l.slug
order by 2 desc;

create view public.v_progress_vs_target as
with total as (
  select count(*) filter (where status = 'confirmed') as confirmed from public.waitlist_signups
), nxt as (
  select target_date, cumulative_target
  from public.waitlist_targets
  where target_date >= current_date
  order by target_date
  limit 1
)
select
  t.confirmed,
  n.target_date as next_target_date,
  n.cumulative_target as next_target,
  t.confirmed - n.cumulative_target as vs_target
from total t left join nxt n on true;

revoke all on public.v_waitlist_totals, public.v_signups_daily, public.v_signups_by_segment,
  public.v_signups_by_tracked_source, public.v_signups_by_self_reported, public.v_attribution_compare,
  public.v_confirmation_funnel, public.v_link_performance, public.v_progress_vs_target
  from anon, authenticated;
