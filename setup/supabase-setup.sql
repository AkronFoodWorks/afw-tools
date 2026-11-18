-- =====================================================================
-- Akron Food Works — cloud save setup
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run: every statement is idempotent.
-- =====================================================================

-- One row per SAVED ITEM. A member can keep many named saves per tool
-- (e.g. several cost cards), so the key is a generated `id`, not
-- (member, tool). The tool's entire saved state lives in the jsonb
-- `data` column — identical to the tool's JSON export file. Nothing
-- about any tool's internal schema needs to change.
--
-- These columns are exactly what afw-cloud.js reads and writes
-- (table name: TABLE = "afw_saves"):
--   id          generated on insert; used for open / update / delete
--               and in the hub's "?open=<id>" links
--   user_id     set by the client to the signed-in member's id
--   tool        the tool's permanent key, e.g. 'food-cost'
--   title       the name the member gave it (client caps it at 120)
--   data        the tool's serialized state
--   updated_at  set by the client on every save; lists sort by it

create table if not exists public.afw_saves (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  tool        text        not null,
  title       text        not null default 'Untitled',
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Every list query is "this member's saves [for this tool], newest
-- first", so index exactly that.
create index if not exists afw_saves_user_tool_updated_idx
  on public.afw_saves (user_id, tool, updated_at desc);

-- Signed-in members talk to this table through the Data API as the
-- `authenticated` role. Signed-out visitors (`anon`) get nothing.
grant select, insert, update, delete on table public.afw_saves to authenticated;
revoke all on table public.afw_saves from anon;

-- Row Level Security: this is what makes the public "anon" key safe to
-- ship in browser code. A signed-in member can only ever see or touch
-- rows where user_id matches their own auth identity.

alter table public.afw_saves enable row level security;

drop policy if exists "members read own saves"   on public.afw_saves;
drop policy if exists "members insert own saves" on public.afw_saves;
drop policy if exists "members update own saves" on public.afw_saves;
drop policy if exists "members delete own saves" on public.afw_saves;

create policy "members read own saves"
  on public.afw_saves for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "members insert own saves"
  on public.afw_saves for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "members update own saves"
  on public.afw_saves for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "members delete own saves"
  on public.afw_saves for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- (No anonymous access policy exists, so signed-out visitors can read
--  and write nothing — public tools like Hours-That-Pay simply never
--  talk to the database unless someone chooses to sign in.)
