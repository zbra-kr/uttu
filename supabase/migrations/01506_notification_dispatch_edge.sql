-- Notification-only cloud dispatcher. Apply atomically after explicit approval.
-- Installs DISABLED. Does not schedule a job, create secrets, send messages,
-- change preferences, mark old notifications, or alter authentication policies.
create table public.user_notification_dispatch_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  legacy_stopped_at timestamptz,
  dispatch_created_after timestamptz,
  check (not enabled or (legacy_stopped_at is not null and dispatch_created_after is not null)),
  check (dispatch_created_after is null or (legacy_stopped_at is not null and legacy_stopped_at <= dispatch_created_after))
);
insert into public.user_notification_dispatch_control(singleton) values(true);

-- The initial rollout authorizes future notifications, not the old unsent inbox.
-- Generate the cutoff in the database only on first activation. Pauses/resumes
-- retain it; neither historical replay nor resetting it is an ordinary toggle.
create function public.uttu_dispatch_control_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.dispatch_created_after is distinct from old.dispatch_created_after then
    raise exception 'Dispatch cutoff is database-generated and immutable' using errcode='22023';
  end if;
  if old.dispatch_created_after is not null and new.legacy_stopped_at is distinct from old.legacy_stopped_at then
    raise exception 'Dispatch shutdown evidence is immutable after activation' using errcode='22023';
  end if;
  if old.dispatch_created_after is null and new.enabled then
    if new.legacy_stopped_at is null or new.legacy_stopped_at > clock_timestamp() then
      raise exception 'Verified legacy shutdown is required before activation' using errcode='22023';
    end if;
    new.dispatch_created_after := clock_timestamp();
  end if;
  return new;
end;
$$;
create trigger on_notification_dispatch_control_update before update on public.user_notification_dispatch_control
for each row execute function public.uttu_dispatch_control_guard();

create table public.user_notification_dispatch_deliveries (
  notification_id uuid not null references public.user_notifications(id) on delete cascade,
  channel public.notification_channel not null,
  status text not null default 'pending' check(status in ('pending','claimed','sending','accepted','skipped','failed','unknown')),
  claim_id uuid,
  lease_expires_at timestamptz,
  attempted_at timestamptz,
  finished_at timestamptz,
  error_code text,
  provider_message_id text,
  retry_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(notification_id,channel),
  check(status <> 'accepted' or attempted_at is not null)
);
create index user_notification_dispatch_pending_idx on public.user_notification_dispatch_deliveries(status,created_at);
alter table public.user_notification_dispatch_control enable row level security;
alter table public.user_notification_dispatch_deliveries enable row level security;
revoke all on public.user_notification_dispatch_control,public.user_notification_dispatch_deliveries from public,anon,authenticated,service_role;

create function public.uttu_dispatch_require_service()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode='42501';
  end if;
end;
$$;

create function public.uttu_dispatch_claim(p_channels text[],p_limit integer default 20)
returns table(notification_id uuid,channel text,claim_id uuid)
language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz;
begin
  perform public.uttu_dispatch_require_service();
  if p_limit is null or p_limit<1 or p_limit>25 or p_channels is null
     or cardinality(p_channels) not between 1 and 2 or array_position(p_channels,null) is not null
     or not p_channels <@ array['teams','telegram']::text[] then
    raise exception 'Invalid dispatch batch' using errcode='22023';
  end if;
  select dispatch_created_after into cutoff from public.user_notification_dispatch_control where singleton and enabled;
  if cutoff is null then return; end if;
  -- An expired pre-send claim is safe to reclaim. An attempted send is not.
  update public.user_notification_dispatch_deliveries d set status='unknown',error_code='attempt_outcome_unknown',finished_at=now(),updated_at=now()
    where d.status='sending' and d.lease_expires_at<=now();
  update public.user_notification_dispatch_deliveries d set status='pending',claim_id=null,lease_expires_at=null,updated_at=now()
    where d.status='claimed' and d.lease_expires_at<=now() and d.attempted_at is null;
  -- Pre-cutover rows stay untouched, including NULL legacy sent markers. Their
  -- history is not an approved replay queue. Non-null markers are also retained.
  insert into public.user_notification_dispatch_deliveries(notification_id,channel)
    select n.id,c.channel::public.notification_channel
    from public.user_notifications n cross join unnest(p_channels) as c(channel)
    where n.created_at >= cutoff
      and ((c.channel='teams' and n.event_type<>'mention' and n.sent_to_teams_at is null)
       or (c.channel='telegram' and n.sent_to_telegram_at is null))
      and not exists(select 1 from public.user_notification_dispatch_deliveries d where d.notification_id=n.id and d.channel::text=c.channel)
    order by n.created_at,n.id,c.channel limit p_limit
    on conflict do nothing;
  return query
    with selected as (
      select d.notification_id,d.channel from public.user_notification_dispatch_deliveries d
      join public.user_notifications n on n.id=d.notification_id
      where d.status='pending' and d.channel::text=any(p_channels) and n.created_at >= cutoff
      order by d.created_at,d.notification_id,d.channel for update of d skip locked limit p_limit
    )
    update public.user_notification_dispatch_deliveries d set status='claimed',claim_id=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now()
    from selected s where d.notification_id=s.notification_id and d.channel=s.channel
    returning d.notification_id,d.channel::text,d.claim_id;
end;
$$;

create function public.uttu_dispatch_begin(p_notification_id uuid,p_channel text,p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.user_notification_dispatch_deliveries; n public.user_notifications; target text; eligible boolean; reason text; cutoff timestamptz;
begin
  perform public.uttu_dispatch_require_service();
  select * into d from public.user_notification_dispatch_deliveries x
    where x.notification_id=p_notification_id and x.channel::text=p_channel for update;
  if not found or d.status<>'claimed' or d.claim_id is distinct from p_claim_id or d.lease_expires_at<=now() then return null; end if;
  select dispatch_created_after into cutoff from public.user_notification_dispatch_control where singleton and enabled;
  if cutoff is null then return null; end if;
  select * into n from public.user_notifications where id=p_notification_id;
  if not found then return null; end if;
  -- Recheck current subscription/role/target immediately before the attempt.
  eligible:=exists(select 1 from public.user_notification_subscriptions s where s.user_id=n.user_id
    and s.event_type=n.event_type and s.channel::text=p_channel and s.enabled);
  reason:='subscription_disabled_or_missing';
  if p_channel='teams' then
    if n.event_type='mention' then eligible:=false;reason:='author_delegated_only';end if;
    select nullif(btrim(p.teams_webhook_url),'') into target from public.profiles p where p.id=n.user_id;
  elsif p_channel='telegram' then
    select nullif(btrim(p.telegram_chat_id),'') into target from public.profiles p where p.id=n.user_id and p.role='admin';
  else return null;
  end if;
  if target is null then eligible:=false;reason:='recipient_not_configured_or_eligible';end if;
  if (p_channel='teams' and n.sent_to_teams_at is not null) or (p_channel='telegram' and n.sent_to_telegram_at is not null) then
    eligible:=false;reason:='legacy_processed_before_attempt';
  end if;
  if n.created_at is null or n.created_at < cutoff then eligible:=false;reason:='before_dispatch_cutover';end if;
  if not eligible then
    update public.user_notification_dispatch_deliveries set status='skipped',error_code=reason,finished_at=now(),updated_at=now()
      where notification_id=p_notification_id and channel::text=p_channel;
    return null;
  end if;
  update public.user_notification_dispatch_deliveries set status='sending',attempted_at=now(),updated_at=now()
    where notification_id=p_notification_id and channel::text=p_channel;
  return jsonb_build_object('notificationId',n.id,'channel',p_channel,'claimId',p_claim_id,
    'title',n.title,'body',n.body,'link',n.link,'target',target);
end;
$$;

create function public.uttu_dispatch_finish(p_notification_id uuid,p_channel text,p_claim_id uuid,p_status text,
  p_error_code text default null,p_provider_message_id text default null,p_retry_after timestamptz default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.user_notification_dispatch_deliveries;
begin
  perform public.uttu_dispatch_require_service();
  if p_status is null or p_status not in ('accepted','failed','unknown') or length(p_error_code)>100 or length(p_provider_message_id)>200 then
    raise exception 'Invalid dispatch result' using errcode='22023';
  end if;
  select * into d from public.user_notification_dispatch_deliveries x where x.notification_id=p_notification_id and x.channel::text=p_channel for update;
  if not found or d.claim_id is distinct from p_claim_id or d.attempted_at is null
     or (d.status<>'sending' and not(d.status='unknown' and p_status='accepted')) then return false;end if;
  if p_channel='telegram' and p_status='accepted' and nullif(p_provider_message_id,'') is null then
    raise exception 'Telegram acceptance requires message id' using errcode='22023';
  end if;
  update public.user_notification_dispatch_deliveries set status=p_status,error_code=p_error_code,provider_message_id=p_provider_message_id,
    retry_after=p_retry_after,finished_at=now(),updated_at=now() where notification_id=p_notification_id and channel::text=p_channel;
  -- Only definite provider acceptance writes the legacy success timestamp.
  -- It does not assert that the recipient has read the message.
  if p_status='accepted' then
    if p_channel='teams' then update public.user_notifications set sent_to_teams_at=now() where id=p_notification_id;
    elsif p_channel='telegram' then update public.user_notifications set sent_to_telegram_at=now() where id=p_notification_id;end if;
  end if;
  return true;
end;
$$;

create function public.uttu_dispatch_release(p_notification_id uuid,p_channel text,p_claim_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
  perform public.uttu_dispatch_require_service();
  update public.user_notification_dispatch_deliveries set status='pending',claim_id=null,lease_expires_at=null,updated_at=now()
    where notification_id=p_notification_id and channel::text=p_channel and claim_id=p_claim_id and status='claimed' and attempted_at is null;
  get diagnostics updated=row_count;return updated=1;
end;
$$;

revoke all on function public.uttu_dispatch_control_guard(),public.uttu_dispatch_require_service(),public.uttu_dispatch_claim(text[],integer),public.uttu_dispatch_begin(uuid,text,uuid),
  public.uttu_dispatch_finish(uuid,text,uuid,text,text,text,timestamptz),public.uttu_dispatch_release(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.uttu_dispatch_claim(text[],integer),public.uttu_dispatch_begin(uuid,text,uuid),
  public.uttu_dispatch_finish(uuid,text,uuid,text,text,text,timestamptz),public.uttu_dispatch_release(uuid,text,uuid) to service_role;
-- Abort on inherited/default grants that would expose targets or forge status.
do $$ declare r text;t text;f record;begin
  foreach r in array array['anon','authenticated','service_role'] loop
    foreach t in array array['public.user_notification_dispatch_control','public.user_notification_dispatch_deliveries'] loop
      if has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Dispatch preflight: direct API table access';end if;
    end loop;
  end loop;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'uttu_dispatch_%' loop
    if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') then raise exception 'Dispatch preflight: public function execution';end if;
  end loop;
  if has_function_privilege('service_role','public.uttu_dispatch_require_service()','EXECUTE') then raise exception 'Dispatch preflight: public helper execution';end if;
  if has_function_privilege('service_role','public.uttu_dispatch_control_guard()','EXECUTE') then raise exception 'Dispatch preflight: public control trigger execution';end if;
end;$$;
