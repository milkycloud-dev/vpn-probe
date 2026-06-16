-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/jrkwxhuzhgeinzaldjao/sql

-- 1) Country columns for fast sorting/filtering
alter table public.probe_events
  add column if not exists geo_country text generated always as (payload->>'geo_country') stored,
  add column if not exists geo_country_code text generated always as (payload->>'geo_country_code') stored;

create index if not exists probe_events_geo_country_code_idx on public.probe_events (geo_country_code);
create index if not exists probe_events_geo_country_idx on public.probe_events (geo_country);
create index if not exists probe_events_country_type_date_idx
  on public.probe_events (geo_country_code, event_type, created_at desc);

-- 2) Fix RLS for publishable/anon key inserts
grant usage on schema public to anon, authenticated;
grant insert on public.probe_events to anon, authenticated;

drop policy if exists "anon_insert_probe_events" on public.probe_events;
drop policy if exists "insert_probe_events" on public.probe_events;
create policy "insert_probe_events"
  on public.probe_events
  for insert
  to anon, authenticated
  with check (true);

-- Example queries:
-- select geo_country_code, geo_country, count(*) from probe_events group by 1,2 order by count(*) desc;
-- select * from probe_events where geo_country_code = 'RU' order by created_at desc;
-- select * from probe_events where event_type = 'scan_complete' and geo_country_code = 'GB' order by created_at desc;
