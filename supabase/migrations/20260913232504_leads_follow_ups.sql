-- Leads retain their admission independently of the current conversation intent.
create table public.leads (
 workspace_id uuid not null,
 conversation_id uuid not null,
 status text not null default 'new_interest' check(status in ('new_interest','follow_up','later','meeting_booked','no_reply','disqualified')),
 entered_at timestamptz not null default now(),
 revision integer not null default 1 check(revision>0),
 sent_count integer not null default 0 check(sent_count>=0),
 series_revision integer not null default 0,
 anchor_id uuid references public.messages(id),
 due_at timestamptz,
 later_until timestamptz,
 state text not null default 'idle' check(state in ('idle','waiting_reply','scheduled','queued','draft','disabled','error','finished')),
 error_code text,
 primary key(workspace_id,conversation_id),
 foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id),
 check(status<>'later' or later_until is not null)
);
create index leads_due_idx on public.leads(due_at,workspace_id,conversation_id) where status='follow_up' and state='scheduled';
create index leads_later_idx on public.leads(later_until,workspace_id,conversation_id) where status='later';
create index leads_status_idx on public.leads(workspace_id,status,conversation_id);
create index leads_anchor_idx on public.leads(anchor_id) where anchor_id is not null;
alter table public.leads enable row level security;
revoke all on public.leads from public,anon,authenticated;
grant select on public.leads to authenticated;
grant select,insert,update on public.leads to service_role;
create policy leads_read on public.leads for select to authenticated using(app_private.has_role(workspace_id));

alter table public.agents add column follow_ups jsonb not null default '{"enabled":false,"attempts":5,"minDays":2,"maxDays":4,"instructions":"","examples":[]}';
create function app_private.valid_follow_ups(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'enabled') is distinct from 'boolean'
  or coalesce(v->>'attempts','') !~ '^[1-5]$' or coalesce(v->>'minDays','') !~ '^[0-9]{1,3}$'
  or coalesce(v->>'maxDays','') !~ '^[0-9]{1,3}$' then return false;end if;
 if (v->>'minDays')::integer not between 1 and 365 or (v->>'maxDays')::integer not between (v->>'minDays')::integer and 365
  or jsonb_typeof(v->'instructions') is distinct from 'string' or length(v->>'instructions')>8000
  or jsonb_typeof(v->'examples') is distinct from 'array' then return false;end if;
 return jsonb_array_length(v->'examples')<=3 and not exists(select 1 from jsonb_array_elements(v->'examples') e where jsonb_typeof(e)<>'string' or length(btrim(e#>>'{}')) not between 1 and 4000);
end;$$;
revoke all on function app_private.valid_follow_ups(jsonb) from public,anon,authenticated;
alter table public.agents add constraint agents_follow_ups_check check(app_private.valid_follow_ups(follow_ups));
alter table public.drafts add column follow_up_number integer check(follow_up_number between 1 and 5), add column follow_up_anchor_id uuid references public.messages(id);
create index drafts_follow_up_anchor_idx on public.drafts(follow_up_anchor_id) where follow_up_anchor_id is not null;
alter table public.draft_generations add column follow_up_revision integer;
alter table app_private.jobs drop constraint jobs_kind_check;
alter table app_private.jobs add constraint jobs_kind_check check(kind in ('sync','import','classify','reconcile_send','generate','follow_up'));

create or replace function app_private.enrich_agent_guidance() returns trigger language plpgsql set search_path='' as $$
begin
 select new.configuration || jsonb_build_object('customInstructions',a.custom_instructions,'meetingInstructions',a.meeting_instructions,'resources',a.resources,'followUps',a.follow_ups)
 into new.configuration from public.agents a where a.workspace_id=new.workspace_id and a.id=new.agent_id;
 return new;
end;$$;

create or replace function public.save_agent(p_workspace uuid,p_id uuid,p_revision integer,p_config jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare current_row public.agents;new_version integer;
begin
 if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_config)<>'object' or length(coalesce(p_config->>'goal',''))>8000 or length(coalesce(p_config->>'language',''))>80 then raise exception 'Invalid agent' using errcode='22023';end if;
 if not app_private.valid_agent_resources(coalesce(p_config->'resources','[]'::jsonb),p_workspace) then raise exception 'Invalid resources' using errcode='22023';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into current_row from public.agents where workspace_id=p_workspace and id=p_id for update;
 if found then
  if current_row.version<>p_revision then raise exception 'Agent changed; reload before saving' using errcode='PT409';end if;
  update public.agents set name=p_config->>'name',description=coalesce(p_config->>'description',''),goal=coalesce(p_config->>'goal',''),language=coalesce(p_config->>'language','English'),reply_groups=array(select jsonb_array_elements_text(coalesce(p_config->'replyGroups','["positive"]'::jsonb))),knowledge=coalesce(p_config->>'knowledge',''),status=p_config->>'status',custom_instructions=coalesce(p_config->>'customInstructions',current_row.custom_instructions),meeting_instructions=coalesce(p_config->>'meetingInstructions',current_row.meeting_instructions),resources=coalesce(p_config->'resources',current_row.resources),follow_ups=coalesce(p_config->'followUps',current_row.follow_ups)
  where workspace_id=p_workspace and id=p_id returning version into new_version;
 else
  if p_revision<>0 then raise exception 'Agent changed or not found' using errcode='PT409';end if;
  insert into public.agents(id,workspace_id,name,description,goal,language,reply_groups,knowledge,status,custom_instructions,meeting_instructions,resources,follow_ups)
  values(p_id,p_workspace,p_config->>'name',coalesce(p_config->>'description',''),coalesce(p_config->>'goal',''),coalesce(p_config->>'language','English'),array(select jsonb_array_elements_text(coalesce(p_config->'replyGroups','["positive"]'::jsonb))),coalesce(p_config->>'knowledge',''),p_config->>'status',coalesce(p_config->>'customInstructions',''),coalesce(p_config->>'meetingInstructions',''),coalesce(p_config->'resources','[]'::jsonb),coalesce(p_config->'followUps','{"enabled":false,"attempts":5,"minDays":2,"maxDays":4,"instructions":"","examples":[]}'::jsonb)) returning version into new_version;
 end if;
 if p_config->>'status'='active' then
  insert into public.agent_versions(workspace_id,agent_id,version,configuration)
  select workspace_id,id,version,jsonb_build_object('name',name,'goal',goal,'language',language,'replyGroups',to_jsonb(reply_groups),'knowledge',knowledge) from public.agents where workspace_id=p_workspace and id=p_id;
 end if;
 return new_version;
end;$$;

create function app_private.follow_up_settings(p_workspace uuid,p_conversation uuid) returns jsonb language sql stable set search_path='' as $$
 select a.follow_ups from public.agents a where a.workspace_id=p_workspace and a.id=app_private.resolve_sender_agent(p_workspace,p_conversation) and a.status='active' and (a.follow_ups->>'enabled')::boolean;
$$;
create function app_private.follow_up_delay(settings jsonb) returns interval language sql volatile set search_path='' as $$
 select make_interval(days => (settings->>'minDays')::integer + floor(random()*((settings->>'maxDays')::integer-(settings->>'minDays')::integer+1))::integer);
$$;

-- A chosen date is durable. Polling never samples an existing date again.
create function app_private.plan_follow_up(p_workspace uuid,p_conversation uuid,p_anchor timestamptz default null) returns void language plpgsql set search_path='' as $$
declare l public.leads;c public.conversations;m public.messages;settings jsonb;next_state text;
begin
 select * into l from public.leads where workspace_id=p_workspace and conversation_id=p_conversation for update;
 if not found or l.status<>'follow_up' then return;end if;
 select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation;
 select * into m from public.messages where workspace_id=p_workspace and conversation_id=p_conversation order by occurred_at desc,id desc limit 1;
 settings=app_private.follow_up_settings(p_workspace,p_conversation);
 if settings is null then next_state='disabled';
 elsif m.id is null or (m.direction<>'outbound' and p_anchor is null) then next_state='waiting_reply';
 elsif exists(select 1 from public.drafts where workspace_id=p_workspace and conversation_id=p_conversation and status in ('ready','needs_input','snoozed')) then next_state='draft';
 else next_state='scheduled';end if;
 if next_state<>'scheduled' then
  update public.leads set state=next_state,due_at=null,error_code=null,revision=revision+1 where workspace_id=p_workspace and conversation_id=p_conversation and (state<>next_state or due_at is not null);
  return;
 end if;
 if p_anchor is null and l.anchor_id=m.id and l.state in ('scheduled','queued','error') then return;end if;
 update public.leads set state='scheduled',due_at=coalesce(p_anchor,m.occurred_at)+app_private.follow_up_delay(settings),anchor_id=m.id,
  sent_count=case when series_revision<>c.inbound_revision then 0 else sent_count end,series_revision=c.inbound_revision,error_code=null,revision=revision+1
 where workspace_id=p_workspace and conversation_id=p_conversation;
end;$$;

create function app_private.track_lead_conversation() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.leads;m public.messages;
begin
 if new.inbound_revision>0 and exists(select 1 from public.workspace_labels where workspace_id=new.workspace_id and id=new.label_id and intent_group='positive') then
  insert into public.leads(workspace_id,conversation_id,series_revision) values(new.workspace_id,new.id,new.inbound_revision) on conflict do nothing;
 end if;
 select * into l from public.leads where workspace_id=new.workspace_id and conversation_id=new.id for update;
 if not found then return new;end if;
 if tg_op='UPDATE' and new.inbound_revision<>old.inbound_revision then
  update public.leads set revision=revision+1,state=case when status='follow_up' then 'waiting_reply' else state end,due_at=null,error_code=null where workspace_id=new.workspace_id and conversation_id=new.id;
  update public.drafts set status='dismissed',revision=revision+1 where workspace_id=new.workspace_id and conversation_id=new.id and follow_up_number is not null and status in ('ready','needs_input','snoozed');
 end if;
 if l.status='follow_up' then
  -- An unresolved send owns its draft until delivery is known.
  if exists(select 1 from public.send_operations where workspace_id=new.workspace_id and conversation_id=new.id and status in ('sending','unknown')) then return new;end if;
  select * into m from public.messages where workspace_id=new.workspace_id and conversation_id=new.id order by occurred_at desc,id desc limit 1;
  if m.id is distinct from l.anchor_id then
   update public.drafts set status='dismissed',revision=revision+1 where workspace_id=new.workspace_id and conversation_id=new.id and follow_up_number is not null and status in ('ready','needs_input','snoozed');
  end if;
  perform app_private.plan_follow_up(new.workspace_id,new.id);
 end if;
 return new;
end;$$;
create trigger lead_conversation after insert or update of label_id,inbound_revision,last_message_at on public.conversations for each row execute function app_private.track_lead_conversation();

-- Count the draft actually referenced by a successful send, never a dismissed
-- draft, an ambiguous send, or other drafts consumed by a manual reply.
create function app_private.track_follow_up_send() returns trigger language plpgsql security definer set search_path='' as $$
declare number integer;c public.conversations;
begin
 if new.status<>'sent' or old.status='sent' then return new;end if;
 select * into c from public.conversations where workspace_id=new.workspace_id and id=new.conversation_id;
 if c.inbound_revision<>new.source_revision then return new;end if;
 select follow_up_number into number from public.drafts where workspace_id=new.workspace_id and id::text=new.request->>'draftId';
 update public.leads set sent_count=case when series_revision<>c.inbound_revision then coalesce(number,0) else case when number is not null then greatest(sent_count,number) else sent_count end end,
  series_revision=c.inbound_revision,revision=revision+1,state='waiting_reply',due_at=null,error_code=null
 where workspace_id=new.workspace_id and conversation_id=new.conversation_id and status='follow_up';
 perform app_private.plan_follow_up(new.workspace_id,new.conversation_id,new.updated_at);
 return new;
end;$$;
create trigger follow_up_sent after update of status on public.send_operations for each row execute function app_private.track_follow_up_send();

create function public.set_lead_status(p_workspace uuid,p_conversation uuid,p_revision integer,p_status text,p_until timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_status is null or p_status not in ('new_interest','follow_up','later','meeting_booked','no_reply','disqualified') then raise exception 'Invalid status' using errcode='22023';end if;
 if p_status='later' and (p_until is null or p_until<=now()) then raise exception 'Choose a future time' using errcode='22023';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into l from public.leads where workspace_id=p_workspace and conversation_id=p_conversation for update;
 if not found then raise exception 'Lead not found' using errcode='22023';end if;
 if l.revision is distinct from p_revision then raise exception 'Lead changed; reload before continuing' using errcode='PT409';end if;
 if l.status=p_status and p_status<>'later' and l.state<>'error' then return;end if;
 if exists(select 1 from public.send_operations where workspace_id=p_workspace and conversation_id=p_conversation and status in ('sending','unknown')) then raise exception 'Wait for the current send to finish' using errcode='PT409';end if;
 update public.leads set status=p_status,revision=revision+1,due_at=null,anchor_id=null,later_until=case when p_status='later' then p_until else null end,error_code=null,
  sent_count=case when p_status='follow_up' and l.status<>'follow_up' then 0 else sent_count end,
  state=case when p_status='follow_up' then 'waiting_reply' when p_status in ('new_interest','later') then 'idle' else 'finished' end
 where workspace_id=p_workspace and conversation_id=p_conversation;
 update public.drafts set status='dismissed',revision=revision+1 where workspace_id=p_workspace and conversation_id=p_conversation and follow_up_number is not null and status in ('ready','needs_input','snoozed');
 perform app_private.plan_follow_up(p_workspace,p_conversation);
end;$$;
revoke all on function public.set_lead_status(uuid,uuid,integer,text,timestamptz) from public,anon;
grant execute on function public.set_lead_status(uuid,uuid,integer,text,timestamptz) to authenticated;

-- Preserve the existing draft action contract, with one explicit skip hook.
alter function public.act_on_draft(uuid,uuid,integer,text,text,timestamptz,boolean) set schema app_private;
revoke all on function app_private.act_on_draft(uuid,uuid,integer,text,text,timestamptz,boolean) from public,anon,authenticated;
create function public.act_on_draft(p_workspace uuid,p_id uuid,p_revision integer,p_action text,p_body text default null,p_until timestamptz default null,p_remember boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare result integer;d public.drafts;
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 result=app_private.act_on_draft(p_workspace,p_id,p_revision,p_action,p_body,p_until,p_remember);
 select * into d from public.drafts where workspace_id=p_workspace and id=p_id;
 if p_action='dismiss' then perform app_private.plan_follow_up(p_workspace,d.conversation_id,case when d.follow_up_number is not null then now() else null end);end if;
 return result;
end;$$;
revoke all on function public.act_on_draft(uuid,uuid,integer,text,text,timestamptz,boolean) from public,anon;
grant execute on function public.act_on_draft(uuid,uuid,integer,text,text,timestamptz,boolean) to authenticated;

create function public.lead_page(p_workspace uuid,p_query text default '',p_status text default 'active',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 51) returns setof public.conversations language sql stable security invoker set search_path='' as $$
 select c.* from public.conversations c join public.leads l on l.workspace_id=c.workspace_id and l.conversation_id=c.id
 where c.workspace_id=p_workspace and (p_status='all' or p_status='active' and l.status in ('new_interest','follow_up') or l.status=p_status)
 and (p_query='' or strpos(lower(c.contact_name||' '||c.contact_company||' '||c.campaign),lower(left(p_query,200)))>0)
 and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
 order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit greatest(1,least(p_limit,101));
$$;
create function public.lead_counts(p_workspace uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(status,n),'{}'::jsonb)||jsonb_build_object('all',coalesce(sum(n),0),'active',coalesce(sum(n) filter(where status in ('new_interest','follow_up')),0)) from (select status,count(*) n from public.leads where workspace_id=p_workspace group by status) s;
$$;
revoke all on function public.lead_page(uuid,text,text,timestamptz,uuid,integer),public.lead_counts(uuid) from public,anon;
grant execute on function public.lead_page(uuid,text,text,timestamptz,uuid,integer),public.lead_counts(uuid) to authenticated;

-- Existing positive conversations enter New interest without scheduling a draft.
insert into public.leads(workspace_id,conversation_id,series_revision)
 select c.workspace_id,c.id,c.inbound_revision from public.conversations c join public.workspace_labels l on l.workspace_id=c.workspace_id and l.id=c.label_id where c.inbound_revision>0 and l.intent_group='positive' on conflict do nothing;

revoke all on function app_private.follow_up_settings(uuid,uuid),app_private.follow_up_delay(jsonb),app_private.plan_follow_up(uuid,uuid,timestamptz),app_private.track_lead_conversation(),app_private.track_follow_up_send() from public,anon,authenticated;

create function public.server_schedule_follow_ups() returns integer language plpgsql security definer set search_path='' as $$
declare candidate record;l public.leads;settings jsonb;m public.messages;j app_private.jobs;n integer=0;
begin
 for candidate in
  select workspace_id,conversation_id from public.leads
  where (status='later' and later_until<=now()) or (status='follow_up' and state='scheduled' and due_at<=now())
   or (status='follow_up' and state='queued' and exists(select 1 from app_private.jobs job where job.workspace_id=leads.workspace_id and job.kind='follow_up' and job.dedup_key=leads.conversation_id::text||':'||leads.revision::text and job.status in ('failed','done')))
   or (status='follow_up' and state in ('disabled','waiting_reply') and app_private.follow_up_settings(workspace_id,conversation_id) is not null
       and (select direction from public.messages msg where msg.workspace_id=leads.workspace_id and msg.conversation_id=leads.conversation_id order by occurred_at desc,id desc limit 1)='outbound'
       and not exists(select 1 from public.drafts d where d.workspace_id=leads.workspace_id and d.conversation_id=leads.conversation_id and d.status in ('ready','needs_input','snoozed')))
  order by coalesce(due_at,later_until,entered_at),workspace_id,conversation_id limit 50
 loop
  -- All writers acquire the workspace before its lead/draft rows.
  perform 1 from public.workspaces where id=candidate.workspace_id for update skip locked;
  if not found then continue;end if;
  select * into l from public.leads where workspace_id=candidate.workspace_id and conversation_id=candidate.conversation_id for update;
  if l.status='follow_up' and l.state='queued' then
   -- Reconcile terminal jobs while holding workspace first. A job-row trigger
   -- would reverse the lock order used by scheduler and generation writers.
   select * into j from app_private.jobs where workspace_id=l.workspace_id and kind='follow_up' and dedup_key=l.conversation_id::text||':'||l.revision::text and status in ('failed','done');
   if found then
    update public.leads set state=case when j.status='failed' then 'error' else 'disabled' end,error_code=case when j.status='failed' then j.error_code else null end,due_at=null,revision=revision+1 where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
   end if;
   continue;
  end if;
  if l.status='later' and l.later_until<=now() then
   select * into m from public.messages where workspace_id=l.workspace_id and conversation_id=l.conversation_id order by occurred_at desc,id desc limit 1;
   update public.leads set status='follow_up',later_until=null,state='scheduled',due_at=now(),anchor_id=m.id,sent_count=0,
    series_revision=(select inbound_revision from public.conversations where workspace_id=l.workspace_id and id=l.conversation_id),revision=revision+1,error_code=null
   where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
  elsif l.status='follow_up' and l.state in ('disabled','waiting_reply') then
   perform app_private.plan_follow_up(l.workspace_id,l.conversation_id);
  end if;
  select * into l from public.leads where workspace_id=candidate.workspace_id and conversation_id=candidate.conversation_id;
  if l.status<>'follow_up' or l.state<>'scheduled' or l.due_at>now() or l.due_at is null then continue;end if;
  settings=app_private.follow_up_settings(l.workspace_id,l.conversation_id);
  if settings is null then
   update public.leads set state='disabled',due_at=null,revision=revision+1 where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
   continue;
  end if;
  if exists(select 1 from public.send_operations where workspace_id=l.workspace_id and conversation_id=l.conversation_id and status in ('sending','unknown')) then continue;end if;
  if exists(select 1 from public.drafts where workspace_id=l.workspace_id and conversation_id=l.conversation_id and status in ('ready','needs_input','snoozed')) then
   update public.leads set state='draft',due_at=null where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
   continue;
  end if;
  if exists(select 1 from public.draft_generations where workspace_id=l.workspace_id and conversation_id=l.conversation_id and status='queued') then continue;end if;
  if l.sent_count>=(settings->>'attempts')::integer then
   update public.leads set status='no_reply',state='finished',due_at=null,revision=revision+1 where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
  else
   insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(l.workspace_id,'follow_up',l.conversation_id::text||':'||l.revision::text,jsonb_build_object('conversationId',l.conversation_id,'leadRevision',l.revision)) on conflict do nothing;
   update public.leads set state='queued' where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
  end if;
  n=n+1;
 end loop;
 return n;
end;$$;
revoke all on function public.server_schedule_follow_ups() from public,anon,authenticated;
grant execute on function public.server_schedule_follow_ups() to service_role;

create function public.server_complete_follow_up(p_workspace uuid,p_conversation uuid,p_revision integer,p_agent uuid,p_agent_version integer,p_source_revision integer,p_config bigint,p_catalog integer,p_body text,p_missing text,p_run_id uuid,p_draft uuid default null,p_draft_revision integer default null) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.leads;result uuid;settings jsonb;
begin
 perform 1 from public.ai_config_release where singleton and version_id=p_config for share;
 if not found then raise exception 'Configuration changed' using errcode='PT409';end if;
 perform 1 from public.workspaces where id=p_workspace and label_revision=p_catalog for update;
 if not found then raise exception 'Catalog changed' using errcode='PT409';end if;
 select * into l from public.leads where workspace_id=p_workspace and conversation_id=p_conversation for update;
 if not found or l.revision is distinct from p_revision or l.status<>'follow_up' or l.state not in ('queued','draft') then return null;end if;
 if not exists(select 1 from public.conversations where workspace_id=p_workspace and id=p_conversation and inbound_revision=p_source_revision)
  or l.anchor_id is distinct from (select id from public.messages where workspace_id=p_workspace and conversation_id=p_conversation order by occurred_at desc,id desc limit 1) then return null;end if;
 if app_private.resolve_sender_agent(p_workspace,p_conversation) is distinct from p_agent or not exists(select 1 from public.agents where workspace_id=p_workspace and id=p_agent and version=p_agent_version and status='active' and (follow_ups->>'enabled')::boolean) then raise exception 'Agent changed' using errcode='PT409';end if;
 settings=app_private.follow_up_settings(p_workspace,p_conversation);
 if l.sent_count>=(settings->>'attempts')::integer then return null;end if;
 if (nullif(btrim(p_body),'') is null)=(nullif(btrim(p_missing),'') is null) or length(coalesce(p_body,''))>8000 or length(coalesce(p_missing,''))>2000 then raise exception 'Invalid follow-up' using errcode='22023';end if;
 if p_run_id is not null and not exists(select 1 from public.ai_runs where workspace_id=p_workspace and id=p_run_id and conversation_id=p_conversation and agent_id=p_agent and agent_version=p_agent_version and configuration_version=p_config and status='completed') then raise exception 'Invalid AI run' using errcode='22023';end if;
 if exists(select 1 from public.send_operations where workspace_id=p_workspace and conversation_id=p_conversation and status in ('sending','unknown')) then return null;end if;
 if p_draft is null then
  insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,source_revision,body,status,missing_knowledge,follow_up_number,follow_up_anchor_id,ai_run_id)
  values(p_workspace,p_conversation,p_agent,p_agent_version,p_source_revision,coalesce(p_body,''),case when nullif(btrim(p_missing),'') is null then 'ready' else 'needs_input' end,nullif(btrim(p_missing),''),l.sent_count+1,l.anchor_id,p_run_id)
  on conflict(workspace_id,conversation_id) where status in ('ready','needs_input','snoozed') do nothing returning id into result;
 else
  update public.drafts set body=coalesce(p_body,''),missing_knowledge=nullif(btrim(p_missing),''),status=case when nullif(btrim(p_missing),'') is null then 'ready' else 'needs_input' end,revision=revision+1,ai_run_id=p_run_id,agent_id=p_agent,agent_version=p_agent_version,snoozed_until=null
  where workspace_id=p_workspace and id=p_draft and conversation_id=p_conversation and revision=p_draft_revision and follow_up_number is not null and follow_up_anchor_id=l.anchor_id and source_revision=p_source_revision and status in ('ready','needs_input','snoozed') returning id into result;
 end if;
 if result is not null then update public.leads set state='draft',due_at=null,error_code=null where workspace_id=p_workspace and conversation_id=p_conversation;end if;
 return result;
end;$$;
revoke all on function public.server_complete_follow_up(uuid,uuid,integer,uuid,integer,integer,bigint,integer,text,text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.server_complete_follow_up(uuid,uuid,integer,uuid,integer,integer,bigint,integer,text,text,uuid,uuid,integer) to service_role;

-- Follow-up rewrites and missing-knowledge answers use the same Drafts controls.
alter function public.request_draft_generation(uuid,uuid,uuid,integer,uuid,integer,text,text,boolean) set schema app_private;
revoke all on function app_private.request_draft_generation(uuid,uuid,uuid,integer,uuid,integer,text,text,boolean) from public,anon,authenticated;
create function public.request_draft_generation(p_workspace uuid,p_id uuid,p_conversation uuid,p_source_revision integer,p_draft uuid default null,p_revision integer default null,p_instructions text default '',p_answer text default '',p_remember boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.drafts;l public.leads;a public.agents;g public.draft_generations;
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into d from public.drafts where workspace_id=p_workspace and id=p_draft and follow_up_number is not null;
 if not found then return app_private.request_draft_generation(p_workspace,p_id,p_conversation,p_source_revision,p_draft,p_revision,p_instructions,p_answer,p_remember);end if;
 if length(p_instructions)>2000 or length(p_answer)>8000 or p_remember then raise exception 'Invalid generation input' using errcode='22023';end if;
 select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id;
 if found then
  if g.user_id<>auth.uid() or g.conversation_id<>p_conversation or g.expected_draft_id is distinct from p_draft or g.instructions<>p_instructions or g.approved_answer<>p_answer then raise exception 'Request identity changed' using errcode='PT409';end if;
  return g.id;
 end if;
 select * into l from public.leads where workspace_id=p_workspace and conversation_id=p_conversation for update;
 select * into a from public.agents where workspace_id=p_workspace and id=app_private.resolve_sender_agent(p_workspace,p_conversation) and status='active' and (follow_ups->>'enabled')::boolean;
 if a.id is null or l.status is distinct from 'follow_up' then raise exception 'Enable follow-ups for this lead and agent first' using errcode='22023';end if;
 if d.conversation_id is distinct from p_conversation or d.revision is distinct from p_revision or d.source_revision is distinct from p_source_revision or d.status not in ('ready','needs_input','snoozed')
  or not exists(select 1 from public.conversations where workspace_id=p_workspace and id=p_conversation and inbound_revision=p_source_revision)
  or l.anchor_id is distinct from d.follow_up_anchor_id then raise exception 'Draft changed; reload before generating' using errcode='PT409';end if;
 if (select count(*) from public.draft_generations where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=100 then raise exception 'Generation limit reached. Try again later' using errcode='22023';end if;
 insert into public.draft_generations(workspace_id,id,conversation_id,user_id,agent_id,agent_version,source_revision,expected_draft_id,expected_draft_revision,instructions,approved_answer,follow_up_revision)
 values(p_workspace,p_id,p_conversation,auth.uid(),a.id,a.version,p_source_revision,p_draft,p_revision,p_instructions,p_answer,l.revision);
 insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'generate',p_id::text,jsonb_build_object('generationId',p_id));
 return p_id;
end;$$;
revoke all on function public.request_draft_generation(uuid,uuid,uuid,integer,uuid,integer,text,text,boolean) from public,anon;
grant execute on function public.request_draft_generation(uuid,uuid,uuid,integer,uuid,integer,text,text,boolean) to authenticated;

create function public.server_complete_follow_up_generation(p_workspace uuid,p_id uuid,p_body text,p_missing text,p_config bigint,p_catalog integer,p_run_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare g public.draft_generations;result uuid;d public.drafts;previous jsonb;previous_body text;
begin
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id and follow_up_revision is not null for update;
 if not found or g.status<>'queued' then return;end if;
 select * into d from public.drafts where workspace_id=p_workspace and id=g.expected_draft_id for update;
 if found then
  previous_body=coalesce(g.current_draft,d.body);
  if nullif(btrim(previous_body),'') is not null or d.missing_knowledge is not null then
   previous=jsonb_build_object('body',previous_body,'source_revision',d.source_revision,'agent_id',d.agent_id,'agent_version',d.agent_version,'ai_run_id',d.ai_run_id,'missing_knowledge',d.missing_knowledge);
  end if;
 end if;
 result=public.server_complete_follow_up(p_workspace,g.conversation_id,g.follow_up_revision,g.agent_id,g.agent_version,g.source_revision,p_config,p_catalog,p_body,p_missing,p_run_id,g.expected_draft_id,g.expected_draft_revision);
 if result is not null then update public.drafts set previous_version=previous where workspace_id=p_workspace and id=result;end if;
 update public.draft_generations set status=case when result is null then 'cancelled' else 'completed' end,result_draft_id=result,updated_at=now() where workspace_id=p_workspace and id=p_id;
end;$$;
revoke all on function public.server_complete_follow_up_generation(uuid,uuid,text,text,bigint,integer,uuid) from public,anon,authenticated;
grant execute on function public.server_complete_follow_up_generation(uuid,uuid,text,text,bigint,integer,uuid) to service_role;

-- The newer composer can undo a rewrite. Follow-up drafts anchor to the latest
-- sent message, so their restore fence differs from an ordinary inbound reply.
alter function public.restore_previous_draft(uuid,uuid,integer) set schema app_private;
revoke all on function app_private.restore_previous_draft(uuid,uuid,integer) from public,anon,authenticated;
create function public.restore_previous_draft(p_workspace uuid,p_id uuid,p_revision integer)
returns integer language plpgsql security definer set search_path='' as $$
declare d public.drafts;l public.leads;previous jsonb;
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into d from public.drafts where workspace_id=p_workspace and id=p_id for update;
 if d.follow_up_number is null then return app_private.restore_previous_draft(p_workspace,p_id,p_revision);end if;
 select * into l from public.leads where workspace_id=p_workspace and conversation_id=d.conversation_id for update;
 if d.revision is distinct from p_revision or d.status not in ('ready','needs_input','snoozed') or d.previous_version is null then raise exception 'Draft changed; reload before restoring' using errcode='PT409';end if;
 previous=d.previous_version;
 if l.status is distinct from 'follow_up'
  or l.anchor_id is distinct from d.follow_up_anchor_id
  or d.follow_up_anchor_id is distinct from (select id from public.messages where workspace_id=p_workspace and conversation_id=d.conversation_id order by occurred_at desc,id desc limit 1)
  or not exists(select 1 from public.conversations where workspace_id=p_workspace and id=d.conversation_id and inbound_revision=(previous->>'source_revision')::integer)
  or exists(select 1 from public.draft_generations where workspace_id=p_workspace and conversation_id=d.conversation_id and status='queued')
  or exists(select 1 from public.send_operations where workspace_id=p_workspace and conversation_id=d.conversation_id and status in ('sending','unknown'))
 then raise exception 'Conversation changed; review it before restoring' using errcode='PT409';end if;
 update public.drafts set body=previous->>'body',source_revision=(previous->>'source_revision')::integer,
  agent_id=(previous->>'agent_id')::uuid,agent_version=(previous->>'agent_version')::integer,ai_run_id=(previous->>'ai_run_id')::uuid,missing_knowledge=previous->>'missing_knowledge',
  status=case when previous->>'missing_knowledge' is null then 'ready' else 'needs_input' end,snoozed_until=null,previous_version=null,revision=revision+1
 where workspace_id=p_workspace and id=p_id;
 return d.revision+1;
end;$$;
revoke all on function public.restore_previous_draft(uuid,uuid,integer) from public,anon;
grant execute on function public.restore_previous_draft(uuid,uuid,integer) to authenticated;
