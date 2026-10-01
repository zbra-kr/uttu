-- LOCAL REVIEW ONLY. Apply the entire migration in one explicit transaction.
-- No Entra/Supabase configuration, credentials, webhook, or message is changed.
-- Every API entry point is bound to auth.uid(); even service-role calls without
-- that verified user context are rejected. No table is directly exposed.
-- The viewer encrypts token bundles with AES-GCM and UID/tenant/OID AAD before
-- calling put_connection. Encryption keys and plaintext tokens NEVER enter SQL.

-- A tombstone generation survives local grant deletion. An initial OAuth
-- callback started before disconnect must not recreate a deleted connection.
create table public.user_teams_connection_epochs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  epoch uuid not null default gen_random_uuid()
);

create table public.user_teams_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null,
  object_id uuid not null,
  consent_epoch uuid not null,
  token_ciphertext text not null check (length(token_ciphertext) between 32 and 131072),
  granted_scopes text[] not null,
  expires_at timestamptz not null,
  consented_at timestamptz not null default now(),
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);

create table public.user_teams_mention_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- Retain the dedup key after note deletion; recreating a UUID must not
  -- erase a sent/unknown attempt. Live note authorization is checked by RPC.
  note_id uuid not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body_snapshot text not null,
  title_snapshot text not null,
  link_snapshot text not null,
  notification_id uuid references public.user_notifications(id) on delete set null,
  status text not null default 'pending' check (status in
    ('pending','claimed','sent','failed','unknown','skipped','reconnect_required','throttled')),
  claim_id uuid,
  lease_expires_at timestamptz,
  send_started_at timestamptz,
  sent_at timestamptz,
  error_code text,
  message_id text,
  chat_id text,
  retry_after timestamptz,
  connection_version uuid,
  sender_tenant_id uuid,
  sender_object_id uuid,
  recipient_tenant_id uuid,
  recipient_object_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (note_id, author_id, recipient_id),
  check (author_id <> recipient_id),
  check (status <> 'sent' or (send_started_at is not null and sent_at is not null))
);
create index user_teams_deliveries_author_idx
  on public.user_teams_mention_deliveries(author_id, created_at desc);

alter table public.user_teams_connection_epochs enable row level security;
alter table public.user_teams_connections enable row level security;
alter table public.user_teams_mention_deliveries enable row level security;
revoke all on public.user_teams_connection_epochs, public.user_teams_connections, public.user_teams_mention_deliveries
  from public, anon, authenticated, service_role;

-- This helper is deliberately NOT callable by any API role. Supabase Auth
-- owns auth.identities. Never use raw_user_meta_data, email, upn, or names.
-- Tenant is the existing company Azure tenant, not common/organizations.
-- Exact v2 issuer validation rejects look-alikes and cross-tenant identities.
-- Source: https://github.com/supabase/auth/blob/master/internal/api/provider/oidc.go
-- parseAzureIDToken preserves oid/tid in custom_claims and places iss at top level.
create function public.uttu_teams_verified_identity(p_user_id uuid)
returns table (tenant_id uuid, object_id uuid, issuer text)
language plpgsql stable security definer set search_path = '' as $$
declare
  identity_data jsonb;
  identity_count integer;
  v_tenant uuid;
  v_object uuid;
  v_issuer text;
begin
  select count(*) into identity_count from auth.identities i
    where i.user_id = p_user_id and i.provider = 'azure';
  if identity_count <> 1 then return; end if;
  select i.identity_data into identity_data from auth.identities i
    where i.user_id = p_user_id and i.provider = 'azure';
  if jsonb_typeof(identity_data->'custom_claims') is distinct from 'object'
     or jsonb_typeof(identity_data->'custom_claims'->'tid') is distinct from 'string'
     or jsonb_typeof(identity_data->'custom_claims'->'oid') is distinct from 'string'
     or jsonb_typeof(identity_data->'iss') is distinct from 'string' then return; end if;
  begin
    v_tenant := (identity_data->'custom_claims'->>'tid')::uuid;
    v_object := (identity_data->'custom_claims'->>'oid')::uuid;
  exception when invalid_text_representation then return;
  end;
  v_issuer := identity_data->>'iss';
  if v_tenant <> '09cefcf6-a744-4cc2-a8ec-681fe0d1a85a'::uuid
     or v_object = '00000000-0000-0000-0000-000000000000'::uuid
     or v_issuer <> 'https://login.microsoftonline.com/' || v_tenant::text || '/v2.0'
  then return; end if;
  return query select v_tenant, v_object, v_issuer;
end;
$$;

create function public.uttu_teams_require_author(p_author_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_author_id then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;

create function public.uttu_teams_get_author_identity(p_author_id uuid)
returns table (tenant_id uuid, object_id uuid, issuer text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.uttu_teams_require_author(p_author_id);
  return query select * from public.uttu_teams_verified_identity(p_author_id);
end;
$$;

create function public.uttu_teams_get_recipient_identity(p_note_id uuid, p_author_id uuid, p_recipient_id uuid)
returns table (tenant_id uuid, object_id uuid, issuer text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.uttu_teams_require_author(p_author_id);
  if p_recipient_id = p_author_id or not exists (
    select 1 from public.user_notes n where n.id = p_note_id and n.user_id = p_author_id
      and p_recipient_id = any(n.mentioned_user_ids)
  ) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query select * from public.uttu_teams_verified_identity(p_recipient_id);
end;
$$;

create function public.uttu_teams_get_connection(p_author_id uuid)
returns setof public.user_teams_connections
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.uttu_teams_require_author(p_author_id);
  -- Keep an actor's own encrypted grant discoverable for disconnect even if
  -- their Azure identity is later removed or changed. This never authorizes
  -- token use: the server's readBundle and send RPCs verify the current identity.
  return query select c.* from public.user_teams_connections c
    join public.user_teams_connection_epochs e on e.user_id = c.user_id and e.epoch = c.consent_epoch
    where c.user_id = p_author_id;
end;
$$;

create function public.uttu_teams_get_connection_epoch(p_author_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_epoch uuid;
begin
  perform public.uttu_teams_require_author(p_author_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uttu-teams:' || p_author_id::text, 0));
  insert into public.user_teams_connection_epochs(user_id) values (p_author_id)
    on conflict (user_id) do nothing;
  select epoch into v_epoch from public.user_teams_connection_epochs where user_id = p_author_id;
  return v_epoch;
end;
$$;

create function public.uttu_teams_put_connection(
  p_author_id uuid, p_token_ciphertext text, p_granted_scopes text[],
  p_expires_at timestamptz, p_expected_version uuid default null, p_expected_epoch uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_identity record;
  v_existing public.user_teams_connections;
  v_version uuid;
begin
  perform public.uttu_teams_require_author(p_author_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uttu-teams:' || p_author_id::text, 0));
  select * into v_identity from public.uttu_teams_verified_identity(p_author_id);
  if not found then raise exception 'Verified Microsoft identity required' using errcode = '42501'; end if;
  if p_token_ciphertext is null or length(p_token_ciphertext) not between 32 and 131072
     or p_granted_scopes is null or cardinality(p_granted_scopes) > 32
     or p_expires_at is null or p_expires_at <= now()
  then raise exception 'Invalid encrypted connection' using errcode = '22023'; end if;
  if p_expected_version is null and (p_expected_epoch is null or not exists (
    select 1 from public.user_teams_connection_epochs e where e.user_id = p_author_id and e.epoch = p_expected_epoch
  )) then return null; end if;
  select * into v_existing from public.user_teams_connections c where c.user_id = p_author_id;
  if found then
    if v_existing.version is distinct from p_expected_version
       or v_existing.tenant_id <> v_identity.tenant_id or v_existing.object_id <> v_identity.object_id
    then return null; end if;
    update public.user_teams_connections set token_ciphertext = p_token_ciphertext,
      granted_scopes = p_granted_scopes, expires_at = p_expires_at,
      version = gen_random_uuid(), updated_at = now()
      where user_id = p_author_id returning version into v_version;
  else
    -- An old refresh cannot resurrect a connection removed by disconnect.
    if p_expected_version is not null then return null; end if;
    insert into public.user_teams_connections(user_id, tenant_id, object_id, consent_epoch, token_ciphertext, granted_scopes, expires_at)
      values (p_author_id, v_identity.tenant_id, v_identity.object_id, p_expected_epoch, p_token_ciphertext, p_granted_scopes, p_expires_at)
      returning version into v_version;
  end if;
  return v_version;
end;
$$;

create function public.uttu_teams_prepare_mentions(
  p_note_id uuid, p_author_id uuid, p_title text default null, p_link text default null,
  p_send_requested boolean default false, p_expected_body text default null,
  p_expected_recipient_ids uuid[] default null
) returns setof public.user_teams_mention_deliveries
language plpgsql security definer set search_path = '' as $$
declare
  v_note public.user_notes;
  v_recipient uuid;
  v_delivery uuid;
  v_notification uuid;
  v_title text;
  v_link text;
  v_send_requested boolean;
  v_skip_code text;
  v_expected_recipients uuid[];
  v_actual_recipients uuid[];
begin
  perform public.uttu_teams_require_author(p_author_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uttu-teams:' || p_author_id::text, 0));
  select * into v_note from public.user_notes n where n.id = p_note_id and n.user_id = p_author_id for share;
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  -- The browser-submitted reviewed body/recipient set must still match this
  -- locked row. Checking only in the route leaves a read->snapshot edit race.
  if coalesce(p_send_requested, false) then
    if p_expected_body is null or p_expected_recipient_ids is null
       or array_position(p_expected_recipient_ids, null) is not null then
      raise exception 'Mention submission does not match note' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_expected_recipients
      from unnest(p_expected_recipient_ids) x where x <> p_author_id;
    select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_actual_recipients
      from unnest(v_note.mentioned_user_ids) x where x <> p_author_id;
    if v_note.body is distinct from p_expected_body
       or v_actual_recipients is distinct from v_expected_recipients then
      raise exception 'Mention submission does not match note' using errcode = '22023';
    end if;
  end if;
  -- Caller-supplied titles/links are ignored. Public profile view only.
  select coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), '누군가') || '님이 회원님을 멘션했습니다'
    into v_title from public.profiles_public p where p.id = p_author_id;
  v_title := coalesce(v_title, '누군가님이 회원님을 멘션했습니다');
  v_link := '/me/notes/' || p_note_id::text;
  v_send_requested := coalesce(p_send_requested, false);
  if not v_send_requested then v_skip_code := 'author_did_not_request';
  elsif v_note.created_at < now() - interval '5 minutes' then
    v_send_requested := false; v_skip_code := 'submission_expired';
  elsif (select count(distinct x) from unnest(v_note.mentioned_user_ids) x where x <> p_author_id) > 10 then
    v_send_requested := false; v_skip_code := 'too_many_recipients';
  end if;
  for v_recipient in select distinct u.id from auth.users u
    where u.id = any(v_note.mentioned_user_ids) and u.id <> p_author_id
  loop
    v_delivery := null;
    insert into public.user_teams_mention_deliveries(note_id, author_id, recipient_id, body_snapshot, title_snapshot, link_snapshot, status, error_code)
      values (p_note_id, p_author_id, v_recipient, v_note.body, v_title, v_link,
        case when v_send_requested then 'pending' else 'skipped' end, v_skip_code)
      on conflict (note_id, author_id, recipient_id) do nothing returning id into v_delivery;
    if v_delivery is not null then
      -- Adopt a legacy inbox row rather than installing a unique index which
      -- could fail on historical duplicates. The per-author lock + delivery
      -- unique key serialize concurrent/replayed calls to this API.
      select n.id into v_notification from public.user_notifications n
        where n.user_id = v_recipient and n.event_type = 'mention'
          and n.payload->>'note_id' = p_note_id::text
        order by n.created_at, n.id limit 1;
      if v_notification is null then
        insert into public.user_notifications(user_id, event_type, title, body, link, payload)
          values (v_recipient, 'mention', v_title, left(v_note.body, 200), v_link,
            jsonb_build_object('note_id', p_note_id, 'author_id', p_author_id, 'teams_delivery', 'delegated'))
          returning id into v_notification;
      end if;
      -- Preserve legacy read/sent timestamps, while suppressing future webhook
      -- dispatch. NULL sent_to_teams_at continues to mean not actually sent.
      update public.user_notifications set payload = payload || jsonb_build_object('teams_delivery', 'delegated')
        where user_id = v_recipient and event_type = 'mention' and payload->>'note_id' = p_note_id::text;
      update public.user_teams_mention_deliveries set notification_id = v_notification where id = v_delivery;
    end if;
  end loop;
  return query select d.* from public.user_teams_mention_deliveries d
    where d.note_id = p_note_id and d.author_id = p_author_id order by d.recipient_id;
end;
$$;

-- Read-only reconciliation must never prepare newly edited/additional targets.
create function public.uttu_teams_get_delivery_status(p_note_id uuid, p_author_id uuid)
returns setof public.user_teams_mention_deliveries
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.uttu_teams_require_author(p_author_id);
  return query select d.* from public.user_teams_mention_deliveries d
    where d.note_id = p_note_id and d.author_id = p_author_id order by d.recipient_id;
end;
$$;

create function public.uttu_teams_claim_delivery(
  p_note_id uuid, p_author_id uuid, p_recipient_id uuid, p_claim_id uuid
) returns setof public.user_teams_mention_deliveries
language plpgsql security definer set search_path = '' as $$
declare
  v_delivery public.user_teams_mention_deliveries;
  v_connection public.user_teams_connections;
  v_sender record;
  v_recipient record;
begin
  perform public.uttu_teams_require_author(p_author_id);
  if p_claim_id is null then raise exception 'Claim ID required' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uttu-teams:' || p_author_id::text, 0));
  select * into v_delivery from public.user_teams_mention_deliveries d where d.note_id = p_note_id
    and d.author_id = p_author_id and d.recipient_id = p_recipient_id for update;
  if not found then return; end if;
  if v_delivery.status = 'claimed' and v_delivery.lease_expires_at <= now() and v_delivery.send_started_at is not null then
    update public.user_teams_mention_deliveries set status = 'unknown', error_code = 'send_outcome_unknown', updated_at = now()
      where id = v_delivery.id;
    return;
  end if;
  -- A lease can only be replaced BEFORE begin_send. Never reclaim an attempt
  -- which may have reached Graph, including unknown/failed/throttled results.
  if v_delivery.status <> 'pending' and not (v_delivery.status = 'claimed'
    and v_delivery.lease_expires_at <= now() and v_delivery.send_started_at is null) then return; end if;
  if p_recipient_id = p_author_id or not exists (select 1 from public.user_notes n
      where n.id = p_note_id and n.user_id = p_author_id and p_recipient_id = any(n.mentioned_user_ids)
        and n.body = v_delivery.body_snapshot and n.created_at >= now() - interval '5 minutes') then
    update public.user_teams_mention_deliveries set status = 'skipped', error_code = 'mention_changed_or_expired', updated_at = now()
      where id = v_delivery.id;
    return;
  end if;
  if exists (select 1 from public.user_notification_subscriptions s where s.user_id = p_recipient_id
    and s.event_type = 'mention' and s.channel = 'teams' and not s.enabled) then
    update public.user_teams_mention_deliveries set status = 'skipped', error_code = 'recipient_opted_out', updated_at = now()
      where id = v_delivery.id;
    return;
  end if;
  select * into v_sender from public.uttu_teams_verified_identity(p_author_id);
  if not found then
    update public.user_teams_mention_deliveries set status = 'reconnect_required', error_code = 'author_identity_unverified', updated_at = now()
      where id = v_delivery.id;
    return;
  end if;
  select * into v_connection from public.user_teams_connections c where c.user_id = p_author_id
    and c.tenant_id = v_sender.tenant_id and c.object_id = v_sender.object_id;
  if not found then
    update public.user_teams_mention_deliveries set status = 'reconnect_required', error_code = 'connect_required', updated_at = now()
      where id = v_delivery.id;
    return;
  end if;
  select * into v_recipient from public.uttu_teams_verified_identity(p_recipient_id);
  if not found then
    update public.user_teams_mention_deliveries set status = 'skipped', error_code = 'recipient_identity_unverified', updated_at = now()
      where id = v_delivery.id;
    return;
  end if;
  if v_recipient.tenant_id <> v_sender.tenant_id or v_recipient.object_id = v_sender.object_id then
    update public.user_teams_mention_deliveries set status = 'skipped', error_code = 'recipient_not_eligible', updated_at = now()
      where id = v_delivery.id;
    return;
  end if;
  return query update public.user_teams_mention_deliveries set status = 'claimed', claim_id = p_claim_id,
    lease_expires_at = now() + interval '2 minutes', connection_version = v_connection.version,
    sender_tenant_id = v_sender.tenant_id, sender_object_id = v_sender.object_id,
    recipient_tenant_id = v_recipient.tenant_id, recipient_object_id = v_recipient.object_id,
    error_code = null, updated_at = now()
    where id = v_delivery.id returning *;
end;
$$;

create function public.uttu_teams_begin_send(p_delivery_id uuid, p_author_id uuid, p_claim_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_delivery public.user_teams_mention_deliveries;
begin
  perform public.uttu_teams_require_author(p_author_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uttu-teams:' || p_author_id::text, 0));
  select * into v_delivery from public.user_teams_mention_deliveries d where d.id = p_delivery_id
    and d.author_id = p_author_id for update;
  if not found or v_delivery.status <> 'claimed' or v_delivery.claim_id is distinct from p_claim_id
     or v_delivery.lease_expires_at <= now() or v_delivery.send_started_at is not null then return false; end if;
  if not exists (select 1 from public.user_notes n where n.id = v_delivery.note_id and n.user_id = p_author_id
      and v_delivery.recipient_id = any(n.mentioned_user_ids) and n.body = v_delivery.body_snapshot
      and n.created_at >= now() - interval '5 minutes')
     or exists (select 1 from public.user_notification_subscriptions s where s.user_id = v_delivery.recipient_id
       and s.event_type = 'mention' and s.channel = 'teams' and not s.enabled)
     or not exists (select 1 from public.user_teams_connections c where c.user_id = p_author_id
       and c.tenant_id = v_delivery.sender_tenant_id and c.object_id = v_delivery.sender_object_id)
     or not exists (select 1 from public.uttu_teams_verified_identity(p_author_id) i
       where i.tenant_id = v_delivery.sender_tenant_id and i.object_id = v_delivery.sender_object_id)
     or not exists (select 1 from public.uttu_teams_verified_identity(v_delivery.recipient_id) i
       where i.tenant_id = v_delivery.recipient_tenant_id and i.object_id = v_delivery.recipient_object_id)
  then
    update public.user_teams_mention_deliveries set status = 'skipped', error_code = 'authorization_changed', updated_at = now()
      where id = p_delivery_id;
    return false;
  end if;
  update public.user_teams_mention_deliveries set send_started_at = now(), updated_at = now() where id = p_delivery_id;
  return true;
end;
$$;

create function public.uttu_teams_finish_delivery(
  p_delivery_id uuid, p_author_id uuid, p_claim_id uuid, p_status text,
  p_error_code text default null, p_message_id text default null,
  p_chat_id text default null, p_retry_after timestamptz default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_delivery public.user_teams_mention_deliveries;
begin
  perform public.uttu_teams_require_author(p_author_id);
  if p_status not in ('sent','failed','unknown','skipped','reconnect_required','throttled')
     or p_status is null or length(p_error_code) > 200 or length(p_message_id) > 1024 or length(p_chat_id) > 1024 then
    raise exception 'Invalid delivery result' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uttu-teams:' || p_author_id::text, 0));
  select * into v_delivery from public.user_teams_mention_deliveries d where d.id = p_delivery_id
    and d.author_id = p_author_id for update;
  if not found or v_delivery.claim_id is distinct from p_claim_id
     or v_delivery.status not in ('claimed', 'unknown') then return false; end if;
  -- Unknown may only resolve to sent with a definite response from this exact
  -- attempt; it never becomes a new retryable state.
  if v_delivery.status = 'unknown' and p_status <> 'sent' then return false; end if;
  if p_status = 'sent' and (v_delivery.send_started_at is null or nullif(p_message_id, '') is null) then
    raise exception 'Confirmed send response required' using errcode = '22023';
  end if;
  update public.user_teams_mention_deliveries set status = p_status,
    error_code = p_error_code, message_id = p_message_id, chat_id = p_chat_id, retry_after = p_retry_after,
    sent_at = case when p_status = 'sent' then now() else null end, updated_at = now()
    where id = p_delivery_id;
  if p_status = 'sent' then
    update public.user_notifications set sent_to_teams_at = now() where id = v_delivery.notification_id;
  end if;
  return true;
end;
$$;

create function public.uttu_teams_disconnect(p_author_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_cancelled integer;
begin
  perform public.uttu_teams_require_author(p_author_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('uttu-teams:' || p_author_id::text, 0));
  insert into public.user_teams_connection_epochs(user_id, epoch) values (p_author_id, gen_random_uuid())
    on conflict (user_id) do update set epoch = excluded.epoch;
  delete from public.user_teams_connections where user_id = p_author_id;
  update public.user_teams_mention_deliveries set status = 'skipped', error_code = 'author_disconnected', updated_at = now()
    where author_id = p_author_id and send_started_at is null
      and status in ('pending','claimed','failed','reconnect_required','throttled');
  get diagnostics v_cancelled = row_count;
  return v_cancelled;
end;
$$;

-- Token rotation cannot silently rebind ciphertext to another account or
-- consent generation. Disconnect/new initial consent creates a new row instead.
create function public.uttu_teams_immutable_connection()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(new.user_id,new.tenant_id,new.object_id,new.consent_epoch,new.consented_at)
     is distinct from row(old.user_id,old.tenant_id,old.object_id,old.consent_epoch,old.consented_at) then
    raise exception 'Teams connection identity is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger user_teams_connection_identity_immutable before update on public.user_teams_connections
  for each row execute function public.uttu_teams_immutable_connection();

-- Snapshot/identity columns are immutable even to privileged application code.
create function public.uttu_teams_immutable_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(new.note_id,new.author_id,new.recipient_id,new.body_snapshot,new.title_snapshot,new.link_snapshot,new.created_at)
     is distinct from row(old.note_id,old.author_id,old.recipient_id,old.body_snapshot,old.title_snapshot,old.link_snapshot,old.created_at) then
    raise exception 'Teams delivery snapshot is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger user_teams_delivery_snapshot_immutable before update on public.user_teams_mention_deliveries
  for each row execute function public.uttu_teams_immutable_delivery();

-- Revoke PUBLIC defaults (including Supabase default grants) on every function,
-- then expose only actor-bound APIs. Helpers are never client-callable.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'uttu_teams_verified_identity','uttu_teams_require_author','uttu_teams_get_author_identity',
      'uttu_teams_get_recipient_identity','uttu_teams_get_connection','uttu_teams_get_connection_epoch','uttu_teams_put_connection',
      'uttu_teams_prepare_mentions','uttu_teams_get_delivery_status','uttu_teams_claim_delivery','uttu_teams_begin_send',
      'uttu_teams_finish_delivery','uttu_teams_disconnect','uttu_teams_immutable_delivery','uttu_teams_immutable_connection')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
  end loop;
end;
$$;
grant execute on function public.uttu_teams_get_author_identity(uuid),
  public.uttu_teams_get_recipient_identity(uuid,uuid,uuid), public.uttu_teams_get_connection(uuid),
  public.uttu_teams_get_connection_epoch(uuid),
  public.uttu_teams_put_connection(uuid,text,text[],timestamptz,uuid,uuid),
  public.uttu_teams_prepare_mentions(uuid,uuid,text,text,boolean,text,uuid[]),
  public.uttu_teams_get_delivery_status(uuid,uuid), public.uttu_teams_claim_delivery(uuid,uuid,uuid,uuid),
  public.uttu_teams_begin_send(uuid,uuid,uuid),
  public.uttu_teams_finish_delivery(uuid,uuid,uuid,text,text,text,text,timestamptz),
  public.uttu_teams_disconnect(uuid) to authenticated;

-- Fail closed if inherited/default ACLs undermine isolation. This also detects
-- a surprising inherited table grant rather than trusting direct REVOKEs.
do $$
declare r text; f record; t text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    foreach t in array array['public.user_teams_connection_epochs','public.user_teams_connections','public.user_teams_mention_deliveries'] loop
      if has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Teams preflight: API role retains direct table access';
      end if;
    end loop;
  end loop;
  for f in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'uttu_teams_%'
  loop
    if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') then
      raise exception 'Teams preflight: unexpected effective function access';
    end if;
  end loop;
  if has_function_privilege('authenticated','public.uttu_teams_verified_identity(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.uttu_teams_require_author(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.uttu_teams_immutable_delivery()','EXECUTE')
     or has_function_privilege('authenticated','public.uttu_teams_immutable_connection()','EXECUTE') then
    raise exception 'Teams preflight: client can execute a private helper';
  end if;
end;
$$;
