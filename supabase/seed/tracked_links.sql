-- Example tracked links. Convention: slug = {platform-abbrev}-{episode}.
-- utm_source must match the self-reported keys: tiktok, instagram, youtube, linkedin, x.
insert into public.tracked_links (slug, utm_source, utm_medium, utm_campaign, utm_content, destination_path, notes) values
  ('tt-ep012', 'tiktok',    'organic', 'founder-clips', 'ep-012', '/waitlist', 'Example: TikTok episode 12'),
  ('ig-ep012', 'instagram', 'organic', 'founder-clips', 'ep-012', '/waitlist', 'Example: Instagram episode 12'),
  ('yt-ep012', 'youtube',   'organic', 'founder-clips', 'ep-012', '/waitlist', 'Example: YouTube episode 12'),
  ('li-ep012', 'linkedin',  'organic', 'founder-clips', 'ep-012', '/waitlist', 'Example: LinkedIn post 12')
on conflict (slug) do nothing;
