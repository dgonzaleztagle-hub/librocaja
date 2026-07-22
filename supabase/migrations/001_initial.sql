create schema if not exists libro_caja;

grant usage on schema libro_caja to anon, authenticated, service_role;

create type libro_caja.tax_regime as enum ('transparent', 'general_simplified');
create type libro_caja.period_status as enum ('draft', 'in_review', 'closed');
create type libro_caja.account_kind as enum ('bank', 'cash');
create type libro_caja.sync_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create table libro_caja.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  rut text not null,
  name text not null,
  regime libro_caja.tax_regime not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, rut)
);

-- La aplicación es independiente: las credenciales pertenecen al libro de
-- caja y nunca se comparten con el esquema ni las tablas de PlusContable.
create table libro_caja.sii_credentials (
  company_id uuid primary key references libro_caja.companies(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version smallint not null default 1,
  updated_at timestamptz not null default now()
);

create table libro_caja.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  name text not null,
  kind libro_caja.account_kind not null,
  bank text,
  number_last4 text,
  opening_balance bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table libro_caja.rcv_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  period text not null check (period ~ '^\\d{4}-\\d{2}$'),
  source text not null default 'railway',
  payload_sha256 text not null,
  version integer not null,
  imported_at timestamptz not null default now(),
  raw_summary jsonb,
  unique(company_id, period, payload_sha256)
);

create table libro_caja.rcv_documents (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references libro_caja.rcv_snapshots(id) on delete cascade,
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  period text not null,
  direction text not null check (direction in ('purchase', 'sale')),
  document_code integer not null,
  document_type text not null,
  folio text not null,
  counterparty_rut text,
  counterparty_name text,
  issued_on date not null,
  exempt_amount bigint not null default 0,
  net_amount bigint not null default 0,
  vat_amount bigint not null default 0,
  total_amount bigint not null,
  status text not null default 'pending' check (status in ('pending','partial','settled','excluded')),
  unique(snapshot_id, direction, document_code, folio, counterparty_rut)
);

create table libro_caja.bank_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  account_id uuid not null references libro_caja.cash_accounts(id) on delete cascade,
  filename text not null,
  file_sha256 text not null,
  mapping jsonb not null,
  row_count integer not null,
  imported_at timestamptz not null default now(),
  unique(company_id, account_id, file_sha256)
);

create table libro_caja.cash_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  account_id uuid not null references libro_caja.cash_accounts(id) on delete restrict,
  import_id uuid references libro_caja.bank_imports(id) on delete set null,
  period text not null,
  operation_type smallint not null check (operation_type in (0,1,2)),
  occurred_on date not null,
  description text not null,
  reference text,
  amount bigint not null,
  taxable_amount bigint not null default 0,
  category text,
  source text not null check (source in ('rcv','bank','cash','manual')),
  fingerprint text,
  document_number text,
  document_type text,
  issuer_rut text,
  reconciled boolean not null default false,
  excluded boolean not null default false,
  counterpart_movement_id uuid references libro_caja.cash_movements(id),
  created_at timestamptz not null default now(),
  unique(company_id, account_id, fingerprint)
);

create table libro_caja.allocations (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references libro_caja.cash_movements(id) on delete cascade,
  document_id uuid not null references libro_caja.rcv_documents(id) on delete restrict,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(movement_id, document_id)
);

create table libro_caja.period_closures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  period text not null,
  version integer not null,
  status libro_caja.period_status not null default 'draft',
  opening_balance bigint not null,
  closing_balance bigint not null,
  totals jsonb not null,
  forced boolean not null default false,
  force_reason text,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  supersedes_id uuid references libro_caja.period_closures(id),
  unique(company_id, period, version)
);

create table libro_caja.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  period text not null,
  status libro_caja.sync_status not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  step text,
  attempt_count smallint not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table libro_caja.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references libro_caja.companies(id) on delete cascade,
  actor_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index rcv_documents_open_idx on libro_caja.rcv_documents(company_id, status, issued_on);
create index movements_period_idx on libro_caja.cash_movements(company_id, period, occurred_on);
create index jobs_queue_idx on libro_caja.sync_jobs(status, created_at);
create index audit_company_idx on libro_caja.audit_events(company_id, created_at desc);

alter table libro_caja.companies enable row level security;
alter table libro_caja.sii_credentials enable row level security;
alter table libro_caja.cash_accounts enable row level security;
alter table libro_caja.rcv_snapshots enable row level security;
alter table libro_caja.rcv_documents enable row level security;
alter table libro_caja.bank_imports enable row level security;
alter table libro_caja.cash_movements enable row level security;
alter table libro_caja.allocations enable row level security;
alter table libro_caja.period_closures enable row level security;
alter table libro_caja.sync_jobs enable row level security;
alter table libro_caja.audit_events enable row level security;

create policy "owner companies" on libro_caja.companies for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner credentials" on libro_caja.sii_credentials for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children accounts" on libro_caja.cash_accounts for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children snapshots" on libro_caja.rcv_snapshots for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children documents" on libro_caja.rcv_documents for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children imports" on libro_caja.bank_imports for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children movements" on libro_caja.cash_movements for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children closures" on libro_caja.period_closures for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children jobs" on libro_caja.sync_jobs for all using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children audit" on libro_caja.audit_events for select using (exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner company children audit insert" on libro_caja.audit_events for insert with check (actor_id=auth.uid() and exists(select 1 from libro_caja.companies c where c.id=company_id and c.owner_id=auth.uid()));
create policy "owner allocations" on libro_caja.allocations for all using (exists(select 1 from libro_caja.cash_movements m join libro_caja.companies c on c.id=m.company_id where m.id=movement_id and c.owner_id=auth.uid())) with check (exists(select 1 from libro_caja.cash_movements m join libro_caja.companies c on c.id=m.company_id where m.id=movement_id and c.owner_id=auth.uid()));
