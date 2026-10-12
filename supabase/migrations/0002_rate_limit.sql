-- Hashed-IP rate limit counter (Netlify's built-in rate limiting is plan dependent, so we use this).
-- Raw IPs are never stored; ip_hash is a salted SHA-256.
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  hit_at timestamptz not null default now()
);
create index rate_limit_events_ip_time_idx on public.rate_limit_events (ip_hash, hit_at);
alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;
