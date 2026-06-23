-- Run this in the Supabase SQL editor to set up (or migrate to) multi-project support.
-- Safe to run on a fresh database. For existing databases, see the migration notes below.

-- ──────────────────────────────────────────
-- PROJECTS (replaces the old 'settings' table)
-- ──────────────────────────────────────────
create table if not exists projects (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  currency            text default 'EUR',
  alert_threshold_pct int  default 90,
  email_recipients    text[] default '{}',
  boq_file_name       text,
  boq_uploaded_at     timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ──────────────────────────────────────────
-- BOQ ITEMS
-- ──────────────────────────────────────────
create table if not exists boq_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  chapter_id   text,
  chapter_name text,
  item_code    text,
  description  text not null,
  unit         text,
  quantity     numeric,
  unit_price   numeric,
  total_amount numeric,
  created_at   timestamptz default now()
);

create index if not exists boq_items_project_id_idx on boq_items(project_id);

-- ──────────────────────────────────────────
-- INVOICES
-- ──────────────────────────────────────────
create table if not exists invoices (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  invoice_number text,
  supplier       text,
  invoice_date   date,
  total_amount   numeric,
  currency       text default 'EUR',
  file_name      text,
  status         text default 'pending',
  created_at     timestamptz default now()
);

create index if not exists invoices_project_id_idx on invoices(project_id);

-- ──────────────────────────────────────────
-- INVOICE ITEMS
-- ──────────────────────────────────────────
create table if not exists invoice_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references invoices(id) on delete cascade,
  boq_item_id     uuid references boq_items(id),
  description     text,
  unit            text,
  quantity        numeric,
  unit_price      numeric,
  total_amount    numeric,
  match_status    text default 'ok',  -- ok | not_in_boq | warning_quantity | warning_price
  match_notes     text,
  created_at      timestamptz default now()
);

create index if not exists invoice_items_invoice_id_idx  on invoice_items(invoice_id);
create index if not exists invoice_items_boq_item_id_idx on invoice_items(boq_item_id);

-- ──────────────────────────────────────────
-- RLS (disable for service role / internal API usage)
-- ──────────────────────────────────────────
alter table projects      enable row level security;
alter table boq_items     enable row level security;
alter table invoices      enable row level security;
alter table invoice_items enable row level security;

-- Allow all operations for authenticated users (adjust as needed)
create policy if not exists "auth users full access" on projects
  for all using (auth.role() = 'authenticated');
create policy if not exists "auth users full access" on boq_items
  for all using (auth.role() = 'authenticated');
create policy if not exists "auth users full access" on invoices
  for all using (auth.role() = 'authenticated');
create policy if not exists "auth users full access" on invoice_items
  for all using (auth.role() = 'authenticated');

-- ──────────────────────────────────────────
-- MIGRATION NOTES (existing databases)
-- ──────────────────────────────────────────
-- If you have an existing 'settings' table and need to migrate:
--
-- 1. Create projects table (above)
-- 2. INSERT INTO projects SELECT id, name, ... FROM settings LIMIT 1;
-- 3. ALTER TABLE boq_items  ADD COLUMN project_id uuid references projects(id);
-- 4. ALTER TABLE invoices   ADD COLUMN project_id uuid references projects(id);
-- 5. UPDATE boq_items SET project_id = (SELECT id FROM projects LIMIT 1);
-- 6. UPDATE invoices  SET project_id = (SELECT id FROM projects LIMIT 1);
-- 7. ALTER TABLE boq_items  ALTER COLUMN project_id SET NOT NULL;
-- 8. ALTER TABLE invoices   ALTER COLUMN project_id SET NOT NULL;
-- 9. DROP TABLE settings;
