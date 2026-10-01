-- LOCAL REVIEW ONLY. Stop delegated delivery routes before rollback. Applying
-- this removes encrypted local grants and delivery history; it does not revoke
-- Entra consent or remotely delete sent Teams messages. Back up ciphertext and
-- delivery metadata first if needed. No existing inbox rows are deleted.
-- Keep teams_delivery='delegated' payload suppression markers: removing them
-- could cause the legacy webhook dispatcher to resend old mentions.
-- Execute atomically. No CASCADE, unrelated objects must remain untouched.
drop function public.uttu_teams_disconnect(uuid);
drop function public.uttu_teams_finish_delivery(uuid,uuid,uuid,text,text,text,text,timestamptz);
drop function public.uttu_teams_begin_send(uuid,uuid,uuid);
drop function public.uttu_teams_claim_delivery(uuid,uuid,uuid,uuid);
drop function public.uttu_teams_get_delivery_status(uuid,uuid);
drop function public.uttu_teams_prepare_mentions(uuid,uuid,text,text,boolean,text,uuid[]);
drop function public.uttu_teams_put_connection(uuid,text,text[],timestamptz,uuid,uuid);
drop function public.uttu_teams_get_connection_epoch(uuid);
drop function public.uttu_teams_get_connection(uuid);
drop function public.uttu_teams_get_recipient_identity(uuid,uuid,uuid);
drop function public.uttu_teams_get_author_identity(uuid);
drop function public.uttu_teams_require_author(uuid);
drop function public.uttu_teams_verified_identity(uuid);
drop trigger user_teams_delivery_snapshot_immutable on public.user_teams_mention_deliveries;
drop function public.uttu_teams_immutable_delivery();
drop table public.user_teams_mention_deliveries;
drop trigger user_teams_connection_identity_immutable on public.user_teams_connections;
drop function public.uttu_teams_immutable_connection();
drop table public.user_teams_connections;
drop table public.user_teams_connection_epochs;
