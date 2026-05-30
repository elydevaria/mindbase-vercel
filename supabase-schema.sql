-- Paste this in: Supabase dashboard → SQL Editor → Run

create table if not exists library (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  title       text not null,
  content     text not null,
  tags        text[] default '{}',
  note        text default '',
  created_at  timestamptz default now()
);

create index if not exists library_user_id_idx on library(user_id);

alter table library enable row level security;

create policy "Open access" on library for all using (true) with check (true);
