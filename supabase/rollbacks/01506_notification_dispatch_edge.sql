-- Stop the cloud schedule and disable the function before rollback.
-- Refuse to erase delivery history. After first use, retain the ledger and fix
-- forward; never restart the old Mac dispatcher against unknown/failed rows.
do $$ begin
 if exists(select 1 from public.user_notification_dispatch_control where enabled)
 or exists(select 1 from public.user_notification_dispatch_deliveries) then
   raise exception 'Dispatch rollback refused: enabled or history exists; preserve ledger and fix forward';
 end if;
end;$$;
drop function public.uttu_dispatch_release(uuid,text,uuid);
drop function public.uttu_dispatch_finish(uuid,text,uuid,text,text,text,timestamptz);
drop function public.uttu_dispatch_begin(uuid,text,uuid);
drop function public.uttu_dispatch_claim(text[],integer);
drop function public.uttu_dispatch_require_service();
drop table public.user_notification_dispatch_deliveries;
drop trigger on_notification_dispatch_control_update on public.user_notification_dispatch_control;
drop function public.uttu_dispatch_control_guard();
drop table public.user_notification_dispatch_control;
