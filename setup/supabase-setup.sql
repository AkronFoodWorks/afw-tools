-- =====================================================================
-- Akron Food Works — cloud save setup
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run
-- =====================================================================

-- One row per (member, tool). The tool's entire saved state lives in
-- the jsonb `data` column — identical to today's JSON export files.
-- Nothing about any tool's internal schema needs to change.

create table if not exists public.tool_data (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  tool_id     text        not null,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, tool_id)
);

-- Row Level Security: this is what makes the public "anon" key safe to
-- ship in browser code. A signed-in member can only ever touch rows
-- where user_id matches their own auth identity.

alter table public.tool_data enable row level security;

create policy "members read own data"
  on public.tool_data for select
  using (auth.uid() = user_id);

create policy "members insert own data"
  on public.tool_data for insert
  with check (auth.uid() = user_id);

create policy "members update own data"
  on public.tool_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "members delete own data"
  on public.tool_data for delete
  using (auth.uid() = user_id);

-- (No anonymous access policy exists, so signed-out visitors can read
--  and write nothing — public tools like Hours-That-Pay simply never
--  talk to the database unless someone chooses to sign in.)
