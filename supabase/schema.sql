create table if not exists public.probe_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in ('visit', 'scan_complete')),
  session_id text not null,
  payload jsonb not null default '{}'::jsonb,
  geo_country text generated always as (payload->>'geo_country') stored,
  geo_country_code text generated always as (payload->>'geo_country_code') stored
);

create index if not exists probe_events_created_at_idx on public.probe_events (created_at desc);
create index if not exists probe_events_event_type_idx on public.probe_events (event_type);
create index if not exists probe_events_session_id_idx on public.probe_events (session_id);
create index if not exists probe_events_geo_country_code_idx on public.probe_events (geo_country_code);
create index if not exists probe_events_geo_country_idx on public.probe_events (geo_country);
create index if not exists probe_events_country_type_date_idx
  on public.probe_events (geo_country_code, event_type, created_at desc);

grant usage on schema public to anon, authenticated;
grant insert on public.probe_events to anon, authenticated;

alter table public.probe_events enable row level security;

drop policy if exists "anon_insert_probe_events" on public.probe_events;
drop policy if exists "insert_probe_events" on public.probe_events;
create policy "insert_probe_events"
  on public.probe_events
  for insert
  to anon, authenticated
  with check (true);
