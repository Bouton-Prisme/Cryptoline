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
  user_id uuid references auth.users(id) on delete cascade
);

alter table if exists public.alerts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists alerts_symbol_idx on public.alerts (symbol);
create index if not exists alerts_status_idx on public.alerts (status);
create index if not exists alerts_created_at_idx on public.alerts (created_at desc);
create index if not exists alerts_user_id_idx on public.alerts (user_id);

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
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table if exists public.alert_events
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists alert_events_alert_id_idx on public.alert_events (alert_id);
create index if not exists alert_events_symbol_idx on public.alert_events (symbol);
create index if not exists alert_events_created_at_idx on public.alert_events (created_at desc);
create index if not exists alert_events_user_id_idx on public.alert_events (user_id);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  risk_profile text not null default 'balanced',
  default_network text not null default 'ethereum',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_risk_profile_check
    check (risk_profile in ('conservative', 'balanced', 'aggressive')),
  constraint profiles_default_network_check
    check (default_network in ('ethereum', 'polygon', 'arbitrum', 'base'))
);

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create table if not exists public.wallets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  wallet_type text not null,
  provider text not null,
  address text,
  network text not null default 'ethereum',
  chain_family text not null default 'evm',
  connection_status text not null default 'manual',
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_wallet_type_check
    check (wallet_type in ('self-custody', 'exchange', 'watch-only')),
  constraint wallets_chain_family_check
    check (chain_family in ('evm', 'solana', 'bitcoin', 'cosmos', 'tron', 'other')),
  constraint wallets_connection_status_check
    check (connection_status in ('manual', 'connected', 'syncing', 'error', 'disabled'))
);

alter table if exists public.wallets
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists name text,
  add column if not exists wallet_type text,
  add column if not exists provider text,
  add column if not exists address text,
  add column if not exists network text not null default 'ethereum',
  add column if not exists chain_family text not null default 'evm',
  add column if not exists connection_status text not null default 'manual',
  add column if not exists is_primary boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists wallets_user_provider_address_idx
  on public.wallets (user_id, provider, address)
  where address is not null;
create index if not exists wallets_user_id_idx on public.wallets (user_id);
create index if not exists wallets_wallet_type_idx on public.wallets (wallet_type);
create index if not exists wallets_chain_family_idx on public.wallets (chain_family);

create table if not exists public.exchange_connections (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id text references public.wallets(id) on delete set null,
  provider text not null,
  label text not null,
  permissions jsonb not null default '["read"]'::jsonb,
  encrypted_api_key text,
  encrypted_api_secret text,
  encrypted_passphrase text,
  status text not null default 'configured',
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exchange_connections_status_check
    check (status in ('configured', 'syncing', 'error', 'disabled')),
  constraint exchange_connections_read_only_check
    check (
      permissions <@ '["read"]'::jsonb
      and not permissions ? 'trade'
      and not permissions ? 'withdraw'
    )
);

alter table if exists public.exchange_connections
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists wallet_id text references public.wallets(id) on delete set null,
  add column if not exists provider text,
  add column if not exists label text,
  add column if not exists permissions jsonb not null default '["read"]'::jsonb,
  add column if not exists encrypted_api_key text,
  add column if not exists encrypted_api_secret text,
  add column if not exists encrypted_passphrase text,
  add column if not exists status text not null default 'configured',
  add column if not exists last_sync_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists exchange_connections_user_id_idx
  on public.exchange_connections (user_id);
create index if not exists exchange_connections_wallet_id_idx
  on public.exchange_connections (wallet_id);
create index if not exists exchange_connections_provider_idx
  on public.exchange_connections (provider);

create table if not exists public.custody_positions (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  account text not null default '',
  symbol text not null,
  amount numeric not null default 0,
  cost_basis numeric not null default 0,
  provider text not null default 'Manual',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table if exists public.custody_positions
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists wallet_id text references public.wallets(id) on delete set null;

drop index if exists custody_positions_account_symbol_idx;

create unique index if not exists custody_positions_user_account_symbol_idx
  on public.custody_positions (user_id, account, symbol)
  where user_id is not null;

create index if not exists custody_positions_account_idx on public.custody_positions (account);
create index if not exists custody_positions_symbol_idx on public.custody_positions (symbol);
create index if not exists custody_positions_user_id_idx on public.custody_positions (user_id);
create index if not exists custody_positions_wallet_id_idx on public.custody_positions (wallet_id);

create table if not exists public.dca_plans (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  account text not null,
  provider text not null default '0x',
  symbol text not null,
  "amountPerRun" numeric not null default 0,
  frequency text not null default 'hebdo',
  occurrences integer not null default 0,
  "startDate" date not null default current_date,
  slippage numeric not null default 0.3,
  "chainId" integer not null default 1,
  "baseStable" text not null default 'USDC',
  "sellToken" text,
  "buyToken" text,
  "sellTokenDecimals" integer not null default 6,
  "buyTokenDecimals" integer not null default 18,
  runs_completed integer not null default 0,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_prepared_execution_id text,
  last_error text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

alter table if exists public.dca_plans
  add column if not exists "chainId" integer not null default 1,
  add column if not exists "baseStable" text not null default 'USDC',
  add column if not exists "sellToken" text,
  add column if not exists "buyToken" text,
  add column if not exists "sellTokenDecimals" integer not null default 6,
  add column if not exists "buyTokenDecimals" integer not null default 18,
  add column if not exists runs_completed integer not null default 0,
  add column if not exists next_run_at timestamptz,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_prepared_execution_id text,
  add column if not exists last_error text,
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists dca_plans_account_idx on public.dca_plans (account);
create index if not exists dca_plans_status_idx on public.dca_plans (status);
create index if not exists dca_plans_next_run_idx on public.dca_plans (next_run_at);
create index if not exists dca_plans_created_at_idx on public.dca_plans (created_at desc);
create index if not exists dca_plans_user_id_idx on public.dca_plans (user_id);

create table if not exists public.dca_executions (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
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

alter table if exists public.dca_executions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists dca_executions_account_idx on public.dca_executions (account);
create index if not exists dca_executions_status_idx on public.dca_executions (status);
create index if not exists dca_executions_created_at_idx on public.dca_executions (created_at desc);
create index if not exists dca_executions_user_id_idx on public.dca_executions (user_id);

alter table if exists public.alerts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.alert_events
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.custody_positions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.dca_executions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'alerts'
      and column_name = 'user_id'
      and data_type <> 'uuid'
  ) then
    alter table public.alerts
      alter column user_id type uuid
      using (
        case
          when user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then user_id::uuid
          else null
        end
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alerts_user_id_fkey'
  ) then
    alter table public.alerts
      add constraint alerts_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

alter table public.alerts enable row level security;
alter table public.alert_events enable row level security;
alter table public.wallets enable row level security;
alter table public.exchange_connections enable row level security;
alter table public.custody_positions enable row level security;
alter table public.dca_plans enable row level security;
alter table public.dca_executions enable row level security;

grant select, insert, update, delete on public.alerts to authenticated;
grant select on public.alert_events to authenticated;
grant select, insert, update, delete on public.wallets to authenticated;
grant select, insert, update, delete on public.exchange_connections to authenticated;
grant select, insert, update, delete on public.custody_positions to authenticated;
grant select, insert, update, delete on public.dca_plans to authenticated;
grant select, insert, update on public.dca_executions to authenticated;

drop policy if exists "alerts_select_own" on public.alerts;
drop policy if exists "alerts_insert_own" on public.alerts;
drop policy if exists "alerts_update_own" on public.alerts;
drop policy if exists "alerts_delete_own" on public.alerts;
drop policy if exists "alert_events_select_own" on public.alert_events;
drop policy if exists "wallets_select_own" on public.wallets;
drop policy if exists "wallets_insert_own" on public.wallets;
drop policy if exists "wallets_update_own" on public.wallets;
drop policy if exists "wallets_delete_own" on public.wallets;
drop policy if exists "exchange_connections_select_own" on public.exchange_connections;
drop policy if exists "exchange_connections_insert_own" on public.exchange_connections;
drop policy if exists "exchange_connections_update_own" on public.exchange_connections;
drop policy if exists "exchange_connections_delete_own" on public.exchange_connections;
drop policy if exists "custody_positions_select_own" on public.custody_positions;
drop policy if exists "custody_positions_insert_own" on public.custody_positions;
drop policy if exists "custody_positions_update_own" on public.custody_positions;
drop policy if exists "custody_positions_delete_own" on public.custody_positions;
drop policy if exists "dca_plans_select_own" on public.dca_plans;
drop policy if exists "dca_plans_insert_own" on public.dca_plans;
drop policy if exists "dca_plans_update_own" on public.dca_plans;
drop policy if exists "dca_plans_delete_own" on public.dca_plans;
drop policy if exists "dca_executions_select_own" on public.dca_executions;
drop policy if exists "dca_executions_insert_own" on public.dca_executions;
drop policy if exists "dca_executions_update_own" on public.dca_executions;

create policy "alerts_select_own"
  on public.alerts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "alerts_insert_own"
  on public.alerts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "alerts_update_own"
  on public.alerts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "alerts_delete_own"
  on public.alerts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "alert_events_select_own"
  on public.alert_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "wallets_select_own"
  on public.wallets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "wallets_insert_own"
  on public.wallets
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "wallets_update_own"
  on public.wallets
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "wallets_delete_own"
  on public.wallets
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "exchange_connections_select_own"
  on public.exchange_connections
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "exchange_connections_insert_own"
  on public.exchange_connections
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "exchange_connections_update_own"
  on public.exchange_connections
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "exchange_connections_delete_own"
  on public.exchange_connections
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "custody_positions_select_own"
  on public.custody_positions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "custody_positions_insert_own"
  on public.custody_positions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "custody_positions_update_own"
  on public.custody_positions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "custody_positions_delete_own"
  on public.custody_positions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "dca_plans_select_own"
  on public.dca_plans
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "dca_plans_insert_own"
  on public.dca_plans
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "dca_plans_update_own"
  on public.dca_plans
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "dca_plans_delete_own"
  on public.dca_plans
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "dca_executions_select_own"
  on public.dca_executions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "dca_executions_insert_own"
  on public.dca_executions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "dca_executions_update_own"
  on public.dca_executions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
