-- Disable TEAMS_CONNECTION_REQUIRED and deploy that setting before rollback.
-- Apply the entire file in one explicit transaction. Tokens, identities,
-- connections, delivery outcomes/timestamps, profiles and RLS are unchanged.
-- Abort rather than overwrite a subsequently changed claim implementation.
do $$
begin
  if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
      where p.oid = 'public.uttu_teams_claim_delivery(uuid,uuid,uuid,uuid)'::regprocedure)
     is distinct from 'cec0a8162fb2f317ee46d8d7c373f124' then
    raise exception 'Teams setup rollback: unexpected current claim RPC body';
  end if;
end;
$$;

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
    sender_tenant_id = v_sender.tenant_id, sender_object_id = v_sender.object_id,
    recipient_tenant_id = v_recipient.tenant_id, recipient_object_id = v_recipient.object_id,
    error_code = null, updated_at = now()
    where id = v_delivery.id returning *;
end;
$$;

drop function public.uttu_teams_setup_status(uuid);
alter table public.user_teams_mention_deliveries drop column connection_fingerprint;
