-- Phase 2: 메모 + @mention
-- 수동 적용: Supabase SQL Editor

do $$ begin
  create type entity_type as enum ('company', 'brand', 'product', 'ranking_filter');
exception when duplicate_object then null; end $$;

create table public.user_notes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  body                text not null check (length(body) <= 4000),
  entity_type         entity_type,
  entity_id           text,
  tags                text[] not null default '{}',
  mentioned_user_ids  uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index user_notes_owner_idx    on public.user_notes(user_id, created_at desc);
create index user_notes_entity_idx   on public.user_notes(entity_type, entity_id)
  where entity_type is not null;
create index user_notes_mentions_gin on public.user_notes using gin (mentioned_user_ids);
create index user_notes_tags_gin     on public.user_notes using gin (tags);

-- updated_at 자동 갱신
create or replace function public.touch_user_notes_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists touch_user_notes on public.user_notes;
create trigger touch_user_notes before update on public.user_notes
  for each row execute procedure public.touch_user_notes_updated_at();

-- RLS
alter table public.user_notes enable row level security;

create policy "notes select own or mentioned" on public.user_notes
  for select to authenticated
  using (user_id = auth.uid() or auth.uid() = any(mentioned_user_ids));

create policy "notes insert own" on public.user_notes
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "notes update own" on public.user_notes
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notes delete own" on public.user_notes
  for delete to authenticated
  using (user_id = auth.uid());
