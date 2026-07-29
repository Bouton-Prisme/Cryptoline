create table if not exists public.alert_events (
  id text primary key,
  alert_id text references public.alerts(id) on delete cascade,
  symbol text not null,
  label text not null,
  channel text not null,
  conditions jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  deliveries jsonb not null default '{}'::jsonb,
  status text not null default 'triggered',
  created_at timestamptz not null default now()
);

create index if not exists alert_events_alert_id_idx on public.alert_events (alert_id);
create index if not exists alert_events_symbol_idx on public.alert_events (symbol);
create index if not exists alert_events_created_at_idx on public.alert_events (created_at desc);
