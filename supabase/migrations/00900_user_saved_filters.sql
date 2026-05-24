-- Phase 5: 저장 필터 (user_saved_filters)
create table public.user_saved_filters (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  page        text        not null,
  name        text        not null,
  filter_data jsonb       not null default '{}',
  created_at  timestamptz not null default now(),
  constraint  user_saved_filters_unique unique (user_id, page, name)
);

create index user_saved_filters_user_page_idx
  on public.user_saved_filters(user_id, page);

alter table public.user_saved_filters enable row level security;

create policy "own saved filters"
  on public.user_saved_filters
  for all
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
