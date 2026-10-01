-- One read-only resultset. No credentials, private targets or message bodies.
-- Excluded historical inbox rows are not a send/retry queue.
begin read only;
with control as (select * from public.user_notification_dispatch_control),
channels as (select unnest(array['teams','telegram']) as channel),
unclaimed as (
 select c.channel,n.created_at from public.user_notifications n cross join channels c
 where ((c.channel='teams' and n.event_type<>'mention' and n.sent_to_teams_at is null)
     or (c.channel='telegram' and n.sent_to_telegram_at is null))
 and not exists(select 1 from public.user_notification_dispatch_deliveries d where d.notification_id=n.id and d.channel::text=c.channel)
)
select 'control' as category,null::text as channel,
 case when enabled then 'enabled' else 'disabled' end as status,
 null::bigint as item_count,legacy_stopped_at as oldest_or_verified_at from control
union all
select 'control',null,'cutoff',null,dispatch_created_after from control
union all
select 'delivery',channel::text,status,count(*),min(created_at)
from public.user_notification_dispatch_deliveries group by channel,status
union all
select 'backlog',c.channel,'unclaimed',count(u.channel),min(u.created_at)
from channels c cross join control k left join unclaimed u on u.channel=c.channel and u.created_at>=k.dispatch_created_after
group by c.channel
union all
select case when k.dispatch_created_after is null then 'held_before_activation' else 'excluded_history' end,
 c.channel,'not_scheduled',count(u.channel),min(u.created_at)
from channels c cross join control k left join unclaimed u on u.channel=c.channel and (k.dispatch_created_after is null or u.created_at<k.dispatch_created_after)
group by c.channel,k.dispatch_created_after
order by category,channel,status;
rollback;
