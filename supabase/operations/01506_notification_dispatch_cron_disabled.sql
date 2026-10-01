-- Separate action-time approval required. Install only after the disabled
-- function, dedicated invocation secret, and required extensions are verified.
-- Contains no secret value. A scheduler success only means HTTP was enqueued.
-- This script creates exactly one DISABLED job; it cannot start delivery.
begin;
do $$declare job_id bigint;begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
 or not exists(select 1 from pg_extension where extname='pg_net')
 or not exists(select 1 from pg_extension where extname='supabase_vault') then
   raise exception 'Required Cron/pg_net/Vault extensions are not ready; do not enable extensions implicitly';
 end if;
 if exists(select 1 from cron.job where jobname='uttu-notification-dispatch') then
   raise exception 'A dispatcher job already exists; inspect rather than replace it';
 end if;
 if (select count(*) from vault.secrets where name='uttu_notification_dispatch_secret')<>1 then
   raise exception 'Exactly one dedicated scheduler secret is required';
 end if;
 if exists(select 1 from public.user_notification_dispatch_control where enabled) then
   raise exception 'Prepare the scheduler only while database delivery is disabled';
 end if;
 select cron.schedule('uttu-notification-dispatch','*/5 * * * *',$job$
   select net.http_post(
     url:='https://ogtrvberttzupxrffpoh.supabase.co/functions/v1/notification-dispatch',
     headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-secret',
       (select decrypted_secret from vault.decrypted_secrets where name='uttu_notification_dispatch_secret')),
     body:='{}'::jsonb, timeout_milliseconds:=120000
   );
 $job$) into job_id;
 perform cron.alter_job(job_id,active:=false);
end;$$;
select jobname,schedule,active from cron.job where jobname='uttu-notification-dispatch';
commit;
