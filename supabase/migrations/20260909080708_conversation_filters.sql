-- Advanced conversation filters; existing clients retain the v2 endpoint.
create or replace function public.conversation_page_v3(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_read text default 'all',p_filters jsonb default '[]'::jsonb)
returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c where c.workspace_id=p_workspace and not c.archived and c.inbound_revision>0 and (p_read='all' or (p_read='unread' and c.unread) or (p_read='read' and not c.unread))
    and (p_query='' or c.contact_name ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or c.contact_company ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or (select m.body from public.messages m where m.workspace_id=c.workspace_id and m.conversation_id=c.id order by m.occurred_at desc,m.id desc limit 1) ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%')
    and (p_label is null or p_label=c.label_id::text or (p_label='uncategorized' and c.label_state='uncategorized' and c.classified_revision=c.inbound_revision) or exists(select 1 from public.workspace_labels l where l.workspace_id=c.workspace_id and l.id=c.label_id and 'group:'||l.intent_group=p_label))
    -- Every condition is evaluated before keyset pagination and LIMIT.
    and jsonb_array_length(p_filters)<=10
    and not exists (
      select 1 from jsonb_array_elements(p_filters) f
      where (case f->>'field'
        when 'labels' then exists (
          select 1 from jsonb_array_elements_text(f->'values') v(value)
          where v.value=c.label_id::text or
            (v.value='uncategorized' and c.label_state='uncategorized' and c.classified_revision=c.inbound_revision)
        )
        when 'intent' then exists (select 1 from public.workspace_labels l
          where l.workspace_id=c.workspace_id and l.id=c.label_id and l.intent_group=f->'values'->>0)
        when 'activity' then coalesce(c.last_message_at,c.created_at)>=now()-make_interval(days=>(f->'values'->>0)::integer)
        when 'sender' then (select m.direction from public.messages m
          where m.workspace_id=c.workspace_id and m.conversation_id=c.id
          order by m.occurred_at desc,m.id desc limit 1)=f->'values'->>0
        when 'read' then c.unread=(f->'values'->>0='unread')
        else null end = (f->>'operator'='is')) is not true
    )
    and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
  order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.conversation_page_v3(uuid,text,text,timestamptz,uuid,integer,text,jsonb) from public,anon;
grant execute on function public.conversation_page_v3(uuid,text,text,timestamptz,uuid,integer,text,jsonb) to authenticated;
