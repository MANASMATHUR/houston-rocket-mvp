# Houston Rockets Jersey Inventory MVP

Setup

1) Create `.env.local` in project root and set values:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_MAKE_WEBHOOK_URL=...
VITE_VOICEFLOW_API_URL=...
VITE_VOICEFLOW_API_KEY=...
VITE_OPENAI_API_KEY=...
```

2) Install and run

```
npm install
npm run dev
```

Supabase Schema (SQL)

```
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

create policy "jerseys read" on public.jerseys for select to authenticated using (true);
create policy "jerseys write" on public.jerseys for all to authenticated using (true) with check (true);

create policy "settings read" on public.settings for select to authenticated using (true);
create policy "settings write" on public.settings for all to authenticated using (true) with check (true);
```

Notes

- The inventory table supports inline increment/decrement and direct set for minimal keystrokes.
- Low-stock rows are highlighted. Use Settings to adjust threshold.
- Add Make.com webhook to send alerts when stock is low (to be wired on update).
- Voiceflow and OpenAI keys are optional; without them, the app still works.
