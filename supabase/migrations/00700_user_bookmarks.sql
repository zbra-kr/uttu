-- Phase 3.1: User bookmarks
create table public.user_bookmarks (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  entity_type entity_type not null,
  entity_id   text        not null,
  label       text,
  created_at  timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);

create index user_bookmarks_owner_idx  on public.user_bookmarks(user_id, created_at desc);
create index user_bookmarks_lookup_idx on public.user_bookmarks(entity_type, entity_id);

alter table public.user_bookmarks enable row level security;

create policy "own bookmarks"
  on public.user_bookmarks
  for all
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
