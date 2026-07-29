create table if not exists public.alerts (
  id text primary key,
  symbol text not null,
  label text not null,
  note text,
  channel text not null default 'push',
  status text not null default 'active',
  conditions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_triggered_at timestamptz,
  user_id text
);

create index if not exists alerts_symbol_idx on public.alerts (symbol);
create index if not exists alerts_status_idx on public.alerts (status);
create index if not exists alerts_created_at_idx on public.alerts (created_at desc);

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

create table if not exists public.custody_positions (
  id text primary key,
  account text not null default '',
  symbol text not null,
  amount numeric not null default 0,
  cost_basis numeric not null default 0,
  provider text not null default 'Manual',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists custody_positions_account_symbol_idx
  on public.custody_positions (account, symbol);

create index if not exists custody_positions_account_idx on public.custody_positions (account);
create index if not exists custody_positions_symbol_idx on public.custody_positions (symbol);

create table if not exists public.dca_plans (
  id text primary key,
  account text not null,
  provider text not null default '0x',
  symbol text not null,
  "amountPerRun" numeric not null default 0,
  frequency text not null default 'hebdo',
  occurrences integer not null default 0,
  "startDate" date not null default current_date,
  slippage numeric not null default 0.3,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

create index if not exists dca_plans_account_idx on public.dca_plans (account);
create index if not exists dca_plans_status_idx on public.dca_plans (status);
create index if not exists dca_plans_created_at_idx on public.dca_plans (created_at desc);

create table if not exists public.dca_executions (
  id text primary key,
  account text not null,
  connector text,
  provider text not null default '0x',
  status text not null default 'prepared',
  quote jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  tx_hash text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists dca_executions_account_idx on public.dca_executions (account);
create index if not exists dca_executions_status_idx on public.dca_executions (status);
create index if not exists dca_executions_created_at_idx on public.dca_executions (created_at desc);
