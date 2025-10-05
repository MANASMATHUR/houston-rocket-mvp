-- Run this in Supabase SQL editor
create extension if not exists pgcrypto; -- for gen_random_uuid

create table if not exists public.jerseys (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  edition text not null check (edition in ('Icon','Statement','Association','City')),
  size text not null,
  qty_inventory int not null default 0,
  qty_due_lva int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.settings (
  id int primary key default 1,
  low_stock_threshold int not null default 1
);

alter table public.jerseys enable row level security;
alter table public.settings enable row level security;

-- Create policies idempotently (Postgres doesn't support IF NOT EXISTS for policies)
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'jerseys' and policyname = 'jerseys read'
  ) then
    create policy "jerseys read" on public.jerseys for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'jerseys' and policyname = 'jerseys write'
  ) then
    create policy "jerseys write" on public.jerseys for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'settings' and policyname = 'settings read'
  ) then
    create policy "settings read" on public.settings for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'settings' and policyname = 'settings write'
  ) then
    create policy "settings write" on public.settings for all to authenticated using (true) with check (true);
  end if;
end $$;

insert into public.settings (id, low_stock_threshold) values (1, 1)
on conflict (id) do nothing;

-- Activity logs
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text,
  action text not null,
  details jsonb
);

alter table public.activity_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='activity_logs' and policyname='logs read'
  ) then
    create policy "logs read" on public.activity_logs for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='activity_logs' and policyname='logs write'
  ) then
    create policy "logs write" on public.activity_logs for all to authenticated using (true) with check (true);
  end if;
end $$;


