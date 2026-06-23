-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/zidrcewnlrhhrqqpduay/sql/new

create extension if not exists "uuid-ossp";

create table if not exists settings (
  id uuid primary key default 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  boq_file_name text,
  boq_uploaded_at timestamptz,
  email_recipients text[] default '{}',
  currency text default 'EUR',
  alert_threshold_pct int default 90,
  updated_at timestamptz default now()
);
insert into settings (id) values ('aaaaaaaa-0000-0000-0000-000000000001') on conflict do nothing;

create table if not exists boq_items (
  id uuid primary key default gen_random_uuid(),
  chapter_id text,
  chapter_name text,
  item_code text,
  description text not null,
  unit text,
  quantity numeric default 0,
  unit_price numeric default 0,
  total_amount numeric default 0,
  created_at timestamptz default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  invoice_date date,
  file_name text,
  status text default 'pending',
  total_amount numeric default 0,
  alerts_count int default 0,
  source text default 'dashboard',
  created_at timestamptz default now()
);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  description text,
  chapter_ref text,
  quantity numeric,
  unit_price numeric,
  total_amount numeric,
  boq_item_id uuid references boq_items(id),
  match_status text default 'not_in_boq',
  boq_quantity numeric,
  boq_unit_price numeric,
  quantity_delta numeric,
  price_delta_pct numeric,
  created_at timestamptz default now()
);

alter table settings enable row level security;
alter table boq_items enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;

create policy "auth_all" on settings for all to authenticated using (true) with check (true);
create policy "auth_all" on boq_items for all to authenticated using (true) with check (true);
create policy "auth_all" on invoices for all to authenticated using (true) with check (true);
create policy "auth_all" on invoice_items for all to authenticated using (true) with check (true);
