alter table public.dca_executions
  add column if not exists submitted_at timestamptz,
  add column if not exists tx_hash text,
  add column if not exists error text;

create index if not exists dca_executions_tx_hash_idx on public.dca_executions (tx_hash);
