-- STRYD waitlist: tables. All access is through Netlify functions using the service role key.
-- RLS is enabled with NO policies, and privileges are revoked from anon/authenticated.

create extension if not exists pgcrypto;

create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name_guess text,
  segment text not null
    check (segment in ('parent_travel_hs','runner_active_adult','pro_college_athlete','other')),
  sport text check (sport is null or char_length(sport) <= 80),
  where_heard text not null
    check (where_heard in ('tiktok','instagram','youtube','linkedin','x','friend_referral','event_flyer','search','other')),
  where_heard_other text check (where_heard_other is null or char_length(where_heard_other) <= 120),
  status text not null default 'pending' check (status in ('pending','confirmed')),
  confirm_token_hash text,
  confirm_token_expires_at timestamptz,
  confirm_email_sent_at timestamptz,
  confirmed_at timestamptz,
  age_attested boolean not null check (age_attested),
  consent_at timestamptz not null default now(),
  consent_policy_version text not null,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  link_slug text,
  referrer_host text,
  landing_path text,
  posthog_distinct_id text,
  cio_sync_status text not null default 'pending'
    check (cio_sync_status in ('pending','synced','failed')),
  cio_attempts smallint not null default 0,
  created_at timestamptz not null default now()
);

create unique index waitlist_signups_email_uidx on public.waitlist_signups (lower(email));
create index waitlist_signups_status_created_idx on public.waitlist_signups (status, created_at);
create index waitlist_signups_token_idx on public.waitlist_signups (confirm_token_hash);

-- Identical structure for preview deploys
create table public.waitlist_signups_test (like public.waitlist_signups including all);

create table public.tracked_links (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  utm_source text not null,
  utm_medium text not null,
  utm_campaign text,
  utm_content text,
  destination_path text not null default '/' check (destination_path ~ '^/[A-Za-z0-9/_-]*$'),
  notes text,
  created_at timestamptz not null default now()
);

create table public.link_clicks (
  id bigint generated always as identity primary key,
  slug text not null,
  clicked_at timestamptz not null default now(),
  is_bot boolean not null default false
);
create index link_clicks_slug_time_idx on public.link_clicks (slug, clicked_at);

-- Placeholder pace targets from the roadmap. Review before relying on them.
create table public.waitlist_targets (
  target_date date primary key,
  cumulative_target integer not null
);
insert into public.waitlist_targets values
  ('2026-10-31',150),('2026-11-30',450),('2026-12-31',1000),('2027-01-31',2000),
  ('2027-02-28',3200),('2027-03-31',4500),('2027-04-30',6300),('2027-05-31',8200),
  ('2027-06-30',10000);

-- Lock everything down.
alter table public.waitlist_signups      enable row level security;
alter table public.waitlist_signups_test enable row level security;
alter table public.tracked_links         enable row level security;
alter table public.link_clicks           enable row level security;
alter table public.waitlist_targets      enable row level security;

revoke all on public.waitlist_signups      from anon, authenticated;
revoke all on public.waitlist_signups_test from anon, authenticated;
revoke all on public.tracked_links         from anon, authenticated;
revoke all on public.link_clicks           from anon, authenticated;
revoke all on public.waitlist_targets      from anon, authenticated;
