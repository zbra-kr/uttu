-- Phase 4: 최근 본 (rolling 50 per user)
create table public.user_view_history (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  entity_type entity_type not null,
  entity_id   text        not null,
  label       text,
  viewed_at   timestamptz not null default now()
);

create index user_view_history_recent_idx
  on public.user_view_history(user_id, viewed_at desc);

-- 동일 (user_id, entity_type, entity_id) 기존 행은 viewed_at 갱신만, 없으면 INSERT + rolling 50
create or replace function public.upsert_view_history(
  p_entity_type entity_type, p_entity_id text, p_label text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  update public.user_view_history
     set viewed_at = now(), label = coalesce(p_label, label)
   where user_id = v_user and entity_type = p_entity_type and entity_id = p_entity_id;
  if not found then
    insert into public.user_view_history (user_id, entity_type, entity_id, label)
      values (v_user, p_entity_type, p_entity_id, p_label);
    delete from public.user_view_history
     where user_id = v_user
       and id not in (
         select id from public.user_view_history
          where user_id = v_user
          order by viewed_at desc
          limit 50
       );
  end if;
end;
$$;

alter table public.user_view_history enable row level security;

create policy "own view history"
  on public.user_view_history
  for all
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
