-- LOCAL PREPARATION ONLY. Apply the entire migration in one transaction.
-- Metadata-only, authenticated-own-user status for the optional web/app-API
-- setup gate. This does not enable TEAMS_CONNECTION_REQUIRED, change RLS,
-- return encrypted grants/tokens, refresh a token, or send a Teams message.
-- It relies on 01505's trusted Azure identity helper and protected DB roles.
-- The only existing RPC change adds a sealed-grant correlation fingerprint
-- when a delivery is claimed. Delivery outcomes/timestamps are unchanged.
-- The live BEGIN/COMMIT wrapper must set a bounded LOCAL lock_timeout.
-- Hold the same lock needed by ALTER TABLE before examining old claims so a
-- concurrent baseline claim cannot commit after preflight and escape tagging.
lock table public.user_teams_mention_deliveries in access exclusive mode;

do $$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
      where p.oid = 'public.uttu_teams_claim_delivery(uuid,uuid,uuid,uuid)'::regprocedure)
     is distinct from 'baa4f3e13f28a0f55c426a4e8bb4b1ae' then
    raise exception 'Teams setup preflight: unexpected existing claim RPC body';
  end if;
  if exists (
    select 1 from public.user_teams_mention_deliveries d where d.status = 'claimed'
  ) then
    raise exception 'Teams setup preflight: existing delivery claims must finish normally first';
  end if;
  if exists (
    select 1 from public.user_teams_mention_deliveries d
    where d.status = 'reconnect_required' and not exists (
      select 1 from public.user_teams_connections c
      where c.user_id = d.author_id and c.version = d.connection_version
    )
  ) then
    raise exception 'Teams setup preflight: unmatched historical reconnect evidence';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = 'public.profiles'::regclass and c.relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
      and t.tgfoid = 'public.protect_profile_role()'::regprocedure
      and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'Teams setup preflight: protected profile roles are required';
  end if;
end;
$$;

-- No token/grant is changed. Fingerprints never authorize a connection; the
-- app additionally authenticates the canonical AES-GCM bundle and its AAD.
-- A replayed sealed value cannot erase known reconnect evidence by minting a
-- different connection version through the actor's existing put_connection.
alter table public.user_teams_mention_deliveries add column connection_fingerprint text;
comment on column public.user_teams_mention_deliveries.connection_fingerprint is
  'md5 of canonical sealed grant at claim; private correlation metadata only, never token verification.';
update public.user_teams_mention_deliveries d
set connection_fingerprint = pg_catalog.md5(c.token_ciphertext)
from public.user_teams_connections c
where d.status = 'reconnect_required' and c.user_id = d.author_id
  and c.version = d.connection_version;
-- Connections can rotate while the separate delivery table is locked. Recheck
-- after the exact-match UPDATE so an intervening rotation cannot silently
-- leave unhealthy history unbound and permit replay of its old sealed grant.
do $$
begin
  if exists (
    select 1 from public.user_teams_mention_deliveries d
    where d.status = 'reconnect_required' and d.connection_fingerprint is null
  ) then
    raise exception 'Teams setup preflight: unhealthy history changed during fingerprint backfill';
  end if;
end;
$$;

-- Guarded above against overwriting any unexpected existing implementation.
-- CREATE OR REPLACE preserves the existing authenticated-only ACL.
create or replace function public.uttu_teams_claim_delivery(
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
    connection_fingerprint = pg_catalog.md5(v_connection.token_ciphertext),
    sender_tenant_id = v_sender.tenant_id, sender_object_id = v_sender.object_id,
    recipient_tenant_id = v_recipient.tenant_id, recipient_object_id = v_recipient.object_id,
    error_code = null, updated_at = now()
    where id = v_delivery.id returning *;
end;
$$;

create function public.uttu_teams_setup_status(p_actor_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
  v_identity record;
  v_version uuid;
  v_fingerprint text;
begin
  -- Check the caller before any role or connection lookup, even for admins.
  perform public.uttu_teams_require_author(p_actor_id);
  select p.role into v_role from public.profiles p where p.id = p_actor_id;
  if v_role = 'admin' then
    return pg_catalog.jsonb_build_object('status', 'admin_exempt');
  end if;
  -- Missing or unrecognized protected roles cannot earn the admin exception.
  if v_role is distinct from 'viewer' then
    return pg_catalog.jsonb_build_object('status', 'setup_required');
  end if;

  select * into v_identity from public.uttu_teams_verified_identity(p_actor_id);
  if not found then
    return pg_catalog.jsonb_build_object('status', 'identity_required');
  end if;

  select c.version, pg_catalog.md5(c.token_ciphertext) into v_version, v_fingerprint
  from public.user_teams_connections c
  join public.user_teams_connection_epochs e
    on e.user_id = c.user_id and e.epoch = c.consent_epoch
  where c.user_id = p_actor_id
    and c.tenant_id = v_identity.tenant_id and c.object_id = v_identity.object_id
    and c.granted_scopes @> array['Chat.Create', 'ChatMessage.Send']::text[];
  if not found then
    return pg_catalog.jsonb_build_object('status', 'setup_required');
  end if;

  -- A confirmed failure belongs to the exact sealed grant that was attempted.
  -- Replay of that grant under a new version remains unhealthy. A legitimate
  -- OAuth/refresh saves a freshly sealed value, so old failures cannot poison
  -- a replacement grant. Access-token expiry alone
  -- never implies disconnect: the existing author-send path refreshes on demand.
  if exists (
    select 1 from public.user_teams_mention_deliveries d
    where d.author_id = p_actor_id and d.connection_fingerprint = v_fingerprint
      and d.status = 'reconnect_required'
  ) then
    return pg_catalog.jsonb_build_object('status', 'reconnect_required');
  end if;
  -- Nonsecret version binds the caller's separately authenticated bundle read
  -- to this exact metadata snapshot. A changed version must fail closed.
  return pg_catalog.jsonb_build_object('status', 'connected', 'connection_version', v_version);
end;
$$;

revoke all on function public.uttu_teams_setup_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.uttu_teams_setup_status(uuid) to authenticated;

-- Direct REVOKEs do not remove inherited/default privileges. Abort rather
-- than expose a new API to anonymous callers or the service role.
do $$
begin
  if pg_catalog.has_function_privilege('anon', 'public.uttu_teams_setup_status(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'public.uttu_teams_setup_status(uuid)', 'EXECUTE') then
    raise exception 'Teams setup preflight: unexpected effective RPC access';
  end if;
end;
$$;

comment on function public.uttu_teams_setup_status(uuid) is
  'Own-actor metadata status only; protected DB admin exemption, trusted Azure identity/current epoch/scopes, exact-sealed-grant reconnect evidence; expiry alone is not disconnect.';
