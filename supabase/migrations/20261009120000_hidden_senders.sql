-- Hidden senders: LinkedIn accounts whose replies stay out of the inbox. Their
-- conversations keep syncing but are not listed, labelled or drafted.
alter table public.senders add column hidden boolean not null default false;
-- Copy of the sender's flag so list queries filter without a join.
alter table public.conversations add column sender_hidden boolean not null default false;

create function app_private.copy_sender_hidden() returns trigger language plpgsql set search_path='' as $$
begin
 new.sender_hidden=coalesce((select s.hidden from public.senders s where s.workspace_id=new.workspace_id and s.provider_id=new.sender_id),false);
 return new;
end;$$;
revoke all on function app_private.copy_sender_hidden() from public,anon,authenticated;
create trigger copy_sender_hidden before insert or update of sender_id on public.conversations for each row execute function app_private.copy_sender_hidden();

create function app_private.propagate_sender_hidden() returns trigger language plpgsql set search_path='' as $$
begin
 update public.conversations set sender_hidden=new.hidden
  where workspace_id=new.workspace_id and sender_id=new.provider_id and sender_hidden is distinct from new.hidden;
 return null;
end;$$;
revoke all on function app_private.propagate_sender_hidden() from public,anon,authenticated;
create trigger propagate_sender_hidden after update of hidden on public.senders for each row
 when (old.hidden is distinct from new.hidden) execute function app_private.propagate_sender_hidden();

-- No classification for hidden conversations. An import item counts as skipped
-- so the import run can still complete.
create function app_private.skip_hidden_classification() returns trigger language plpgsql set search_path='' as $$
declare run uuid:=(new.payload->>'runId')::uuid;
begin
 if not exists(select 1 from public.conversations where workspace_id=new.workspace_id and id=(new.payload->>'conversationId')::uuid and sender_hidden) then return new;end if;
 if run is not null then
  update app_private.import_items set skipped=true,classified=false
   where workspace_id=new.workspace_id and run_id=run and conversation_id=(new.payload->>'conversationId')::uuid;
  perform app_private.update_import_progress(run);
 end if;
 return null;
end;$$;
revoke all on function app_private.skip_hidden_classification() from public,anon,authenticated;
create trigger skip_hidden_classification before insert on app_private.jobs for each row
 when (new.kind='classify') execute function app_private.skip_hidden_classification();

create function public.set_sender_hidden(p_workspace uuid,p_sender bigint,p_hidden boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_hidden is null then raise exception 'Invalid value' using errcode='22023';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 update public.senders set hidden=p_hidden where workspace_id=p_workspace and provider_id=p_sender;
 if not found then raise exception 'Sender not found' using errcode='22023';end if;
 if not p_hidden then return;end if;
 -- Work queued before hiding would otherwise still label the conversation.
 with finished as (
  update app_private.jobs j set status='done'
  from public.conversations c
  where j.workspace_id=p_workspace and j.kind='classify' and j.status='queued'
   and c.workspace_id=j.workspace_id and c.id=(j.payload->>'conversationId')::uuid and c.sender_id=p_sender
  returning j.payload
 )
 update app_private.import_items i set skipped=true,classified=false from finished f
  where i.workspace_id=p_workspace and i.run_id=(f.payload->>'runId')::uuid and i.conversation_id=(f.payload->>'conversationId')::uuid;
 perform app_private.update_import_progress(r.id) from public.import_runs r where r.workspace_id=p_workspace and r.status in ('queued','running');
 update app_private.notification_deliveries n set status='skipped',approval_allowed=false
  from public.drafts d join public.conversations c on c.workspace_id=d.workspace_id and c.id=d.conversation_id
  where n.workspace_id=p_workspace and n.kind='draft' and n.status='pending'
   and d.workspace_id=n.workspace_id and d.id=n.draft_id and c.sender_id=p_sender;
end;$$;
revoke all on function public.set_sender_hidden(uuid,bigint,boolean) from public,anon;
grant execute on function public.set_sender_hidden(uuid,bigint,boolean) to authenticated;

-- A hidden sender has no agent, which stops drafts, rewrites and follow-ups.
create or replace function app_private.resolve_sender_agent(p_workspace uuid,p_conversation uuid) returns uuid
language sql stable set search_path='' as $$
 select a.id from public.conversations c
 join public.workspaces w on w.id=c.workspace_id
 left join public.senders s on s.workspace_id=c.workspace_id and s.provider_id=c.sender_id
 join public.agents a on a.workspace_id=c.workspace_id and a.id=coalesce(s.agent_id,w.default_agent_id) and a.status='active'
 where c.workspace_id=p_workspace and c.id=p_conversation and not c.sender_hidden;
$$;

-- Lists and counts leave out hidden conversations; the rest is unchanged.
create or replace function public.conversation_page_v2(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_read text default 'all')
returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c where c.workspace_id=p_workspace and not c.archived and not c.sender_hidden and c.inbound_revision>0 and (p_read='all' or (p_read='unread' and c.unread) or (p_read='read' and not c.unread))
    and (p_query='' or c.contact_name ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or c.contact_company ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or (select m.body from public.messages m where m.workspace_id=c.workspace_id and m.conversation_id=c.id order by m.occurred_at desc,m.id desc limit 1) ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%')
    and (p_label is null or p_label=c.label_id::text or (p_label='uncategorized' and c.label_state='uncategorized' and c.classified_revision=c.inbound_revision) or exists(select 1 from public.workspace_labels l where l.workspace_id=c.workspace_id and l.id=c.label_id and 'group:'||l.intent_group=p_label))
    and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
  order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit least(greatest(p_limit,1),100);
$$;

create or replace function public.conversation_counts(p_workspace uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
select jsonb_build_object('all',count(*),'unread',count(*) filter(where c.unread),
  'interested',count(*) filter(where l.system_key='interested'),
  'meeting_request',count(*) filter(where l.system_key='meeting_request'),
  'information_request',count(*) filter(where l.system_key='information_request'))
from public.conversations c left join public.workspace_labels l on l.workspace_id=c.workspace_id and l.id=c.label_id
where c.workspace_id=p_workspace and not c.archived and not c.sender_hidden and c.inbound_revision>0;
$$;

create or replace function public.conversation_page_v3(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_read text default 'all',p_filters jsonb default '[]'::jsonb)
returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c where c.workspace_id=p_workspace and not c.archived and not c.sender_hidden and c.inbound_revision>0 and (p_read='all' or (p_read='unread' and c.unread) or (p_read='read' and not c.unread))
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
        when 'first_reply' then (select case
          when f->'values'->>0 = 'custom' then
            (first_at at time zone coalesce(f->>'timezone','UTC'))::date >= (f->'values'->>1)::date
            and (first_at at time zone coalesce(f->>'timezone','UTC'))::date <= (f->'values'->>2)::date
          when f->'values'->>0 in ('today','this_week','this_month') then
            first_at >= (date_trunc(case f->'values'->>0 when 'today' then 'day' when 'this_week' then 'week' else 'month' end,
              now() at time zone coalesce(f->>'timezone','UTC')) at time zone coalesce(f->>'timezone','UTC'))
            and first_at <= now()
          else first_at >= now() - (f->'values'->>0)::integer * interval '24 hours' and first_at <= now()
          end from (select m.occurred_at first_at from public.messages m
            where m.workspace_id=c.workspace_id and m.conversation_id=c.id and m.direction='inbound'
            order by m.occurred_at asc limit 1) first_message)
        when 'sender' then (select m.direction from public.messages m
          where m.workspace_id=c.workspace_id and m.conversation_id=c.id
          order by m.occurred_at desc,m.id desc limit 1)=f->'values'->>0
        when 'read' then c.unread=(f->'values'->>0='unread')
        else null end = (f->>'operator'='is')) is not true
    )
    and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
  order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit least(greatest(p_limit,1),100);
$$;

create or replace function public.conversation_count_v3(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_read text default 'all',p_filters jsonb default '[]'::jsonb)
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(*) from public.conversations c where c.workspace_id=p_workspace and not c.archived and not c.sender_hidden and c.inbound_revision>0 and (p_read='all' or (p_read='unread' and c.unread) or (p_read='read' and not c.unread))
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
        when 'first_reply' then (select case
          when f->'values'->>0 = 'custom' then
            (first_at at time zone coalesce(f->>'timezone','UTC'))::date >= (f->'values'->>1)::date
            and (first_at at time zone coalesce(f->>'timezone','UTC'))::date <= (f->'values'->>2)::date
          when f->'values'->>0 in ('today','this_week','this_month') then
            first_at >= (date_trunc(case f->'values'->>0 when 'today' then 'day' when 'this_week' then 'week' else 'month' end,
              now() at time zone coalesce(f->>'timezone','UTC')) at time zone coalesce(f->>'timezone','UTC'))
            and first_at <= now()
          else first_at >= now() - (f->'values'->>0)::integer * interval '24 hours' and first_at <= now()
          end from (select m.occurred_at first_at from public.messages m
            where m.workspace_id=c.workspace_id and m.conversation_id=c.id and m.direction='inbound'
            order by m.occurred_at asc limit 1) first_message)
        when 'sender' then (select m.direction from public.messages m
          where m.workspace_id=c.workspace_id and m.conversation_id=c.id
          order by m.occurred_at desc,m.id desc limit 1)=f->'values'->>0
        when 'read' then c.unread=(f->'values'->>0='unread')
        else null end = (f->>'operator'='is')) is not true
    )
;
$$;

create or replace function app_private.automatic_draft_progress(p_workspace uuid)
returns table(id uuid, conversation_id uuid, source_revision integer, status text,
  error_code text, draft_id uuid, result_revision integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not app_private.has_role(p_workspace) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  return query
  with latest as (
    select distinct on (j.payload->>'conversationId') j.*
    from app_private.jobs j
    where j.workspace_id=p_workspace and j.kind='classify'
      and j.payload->>'generateDraft'='true'
      and (j.status in ('queued','running') or j.created_at > now()-interval '1 day')
    order by j.payload->>'conversationId',j.created_at desc,j.id desc
  )
  select j.id,c.id,c.inbound_revision,
    case
      when not c.agent_enabled or c.contact_stopped or a.id is null
        or m.direction is distinct from 'inbound' then 'cancelled'
      when j.status in ('queued','running') then 'queued'
      when j.status='failed' then 'failed'
      else 'completed'
    end,
    case when j.status='done' and d.id is null then 'no_reply_needed' else j.error_code end,
    d.id,coalesce(d.revision,1)
  from latest j
  join public.conversations c on c.workspace_id=j.workspace_id
    and c.id::text=j.payload->>'conversationId'
    and c.inbound_revision::text=j.payload->>'revision'
  join public.workspaces w on w.id=c.workspace_id
  left join public.senders s on s.workspace_id=c.workspace_id and s.provider_id=c.sender_id
  left join public.agents a on a.workspace_id=c.workspace_id
    and a.id=coalesce(s.agent_id,w.default_agent_id) and a.status='active'
  left join lateral (
    select msg.direction from public.messages msg
    where msg.workspace_id=c.workspace_id and msg.conversation_id=c.id
    order by msg.occurred_at desc,msg.id desc limit 1
  ) m on true
  left join public.drafts d on d.workspace_id=c.workspace_id and d.conversation_id=c.id
    and d.source_revision=c.inbound_revision and d.follow_up_number is null
    and d.status in ('ready','needs_input','snoozed')
  where not c.archived and not c.sender_hidden
  order by j.created_at desc,j.id desc;
end;
$$;

create or replace function public.draft_page(p_workspace uuid,p_status text default null,p_query text default '',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 51,p_label text default null)
returns setof public.drafts language plpgsql stable security definer set search_path='' as $$
declare search text;
begin
 if not app_private.has_role(p_workspace) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_status is not null and p_status not in ('ready','needs_input','snoozed') then raise exception 'Invalid queue' using errcode='22023';end if;
 search=replace(replace(replace(left(coalesce(p_query,''),200),'\','\\'),'%','\%'),'_','\_');
 return query select d.* from public.drafts d join public.conversations c on c.workspace_id=d.workspace_id and c.id=d.conversation_id
 where d.workspace_id=p_workspace and not c.sender_hidden and d.status in ('ready','needs_input','snoozed') and (p_status is null or d.status=p_status)
 and (search='' or c.contact_name ilike '%'||search||'%' or c.contact_company ilike '%'||search||'%')
 and (p_label is null or p_label=c.label_id::text or (p_label='uncategorized' and c.label_state='uncategorized' and c.classified_revision=c.inbound_revision) or exists(select 1 from public.workspace_labels l where l.workspace_id=c.workspace_id and l.id=c.label_id and 'group:'||l.intent_group=p_label))
 and (p_before is null or (d.created_at,d.id)<(p_before,p_before_id))
 order by d.created_at desc,d.id desc limit least(greatest(p_limit,1),101);
end;$$;

create or replace function public.lead_page(p_workspace uuid,p_query text default '',p_status text default 'active',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 51) returns setof public.conversations language sql stable security invoker set search_path='' as $$
 select c.* from public.conversations c join public.leads l on l.workspace_id=c.workspace_id and l.conversation_id=c.id
 where c.workspace_id=p_workspace and not c.sender_hidden and (
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
 from (select l.status,count(*) n from public.leads l
   join public.conversations c on c.workspace_id=l.workspace_id and c.id=l.conversation_id
   where l.workspace_id=p_workspace and not c.sender_hidden group by l.status) s;
$$;
notify pgrst,'reload schema';
