-- Active includes leads paused until a chosen date. Outcomes form a separate view.
create or replace function public.lead_page(p_workspace uuid,p_query text default '',p_status text default 'active',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 51) returns setof public.conversations language sql stable security invoker set search_path='' as $$
 select c.* from public.conversations c join public.leads l on l.workspace_id=c.workspace_id and l.conversation_id=c.id
 where c.workspace_id=p_workspace and (
   p_status='all'
   or p_status='active' and l.status in ('new_interest','follow_up','later')
   or p_status='completed' and l.status in ('meeting_booked','no_reply','disqualified')
   or l.status=p_status)
 and (p_query='' or strpos(lower(c.contact_name||' '||c.contact_company||' '||c.campaign),lower(left(p_query,200)))>0)
 and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
 order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit greatest(1,least(p_limit,101));
$$;
create or replace function public.lead_counts(p_workspace uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(status,n),'{}'::jsonb)||jsonb_build_object(
   'all',coalesce(sum(n),0),
   'active',coalesce(sum(n) filter(where status in ('new_interest','follow_up','later')),0),
   'completed',coalesce(sum(n) filter(where status in ('meeting_booked','no_reply','disqualified')),0))
 from (select status,count(*) n from public.leads where workspace_id=p_workspace group by status) s;
$$;

-- A list preview may contain only our outbound message; fetch inbound dates separately.
create or replace function public.lead_last_replies(p_workspace uuid,p_ids uuid[])
returns table(conversation_id uuid,replied_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select c.id,m.occurred_at from public.conversations c
 join public.leads l on l.workspace_id=c.workspace_id and l.conversation_id=c.id
 cross join lateral (
   select m.occurred_at from public.messages m
   where m.workspace_id=c.workspace_id and m.conversation_id=c.id and m.direction='inbound'
   order by m.occurred_at desc,m.id desc limit 1
 ) m
 where c.workspace_id=p_workspace and c.id=any(p_ids[1:200]);
$$;
revoke all on function public.lead_last_replies(uuid,uuid[]) from public,anon;
grant execute on function public.lead_last_replies(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
