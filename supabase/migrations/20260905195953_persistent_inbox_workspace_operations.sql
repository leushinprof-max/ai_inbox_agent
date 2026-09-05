-- Authenticated operations for the standalone application. No provider credentials.
alter table public.conversations add column notes_revision integer not null default 1;
create index drafts_due_idx on public.drafts(workspace_id, snoozed_until) where status = 'snoozed';

create table public.agent_versions (
  workspace_id uuid not null,
  agent_id uuid not null,
  version integer not null,
  configuration jsonb not null,
  published_at timestamptz not null default now(),
  primary key (workspace_id, agent_id, version),
  foreign key (workspace_id, agent_id) references public.agents(workspace_id,id)
);
alter table public.agent_versions enable row level security;
revoke all on public.agent_versions from public, anon, authenticated;
grant select on public.agent_versions to authenticated;
create policy version_read on public.agent_versions for select to authenticated using(app_private.has_role(workspace_id));

-- Writes use revision-aware operations, rather than last-writer-wins table updates.
revoke insert, update on public.agents from authenticated;
revoke insert(workspace_id,name,description,goal,language,reply_policy,knowledge,status), update(name,description,goal,language,reply_policy,knowledge,status) on public.agents from authenticated;
revoke update(notes,archived) on public.conversations from authenticated;

create function public.save_agent(p_workspace uuid,p_id uuid,p_revision integer,p_config jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare current_row public.agents; new_version integer;
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_config) <> 'object' or length(coalesce(p_config->>'goal','')) > 8000 or length(coalesce(p_config->>'language','')) > 80 then raise exception 'Invalid agent' using errcode='22023'; end if;
  -- Lock the workspace for first-insert races as well as existing agent updates.
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into current_row from public.agents where workspace_id=p_workspace and id=p_id for update;
  if found then
    if current_row.version <> p_revision then raise exception 'Agent changed; reload before saving' using errcode='PT409'; end if;
    update public.agents set name=p_config->>'name', description=coalesce(p_config->>'description',''), goal=coalesce(p_config->>'goal',''),
      language=coalesce(p_config->>'language','English'), reply_policy=coalesce(p_config->>'replyPolicy','positive'), knowledge=coalesce(p_config->>'knowledge',''), status=p_config->>'status'
      where workspace_id=p_workspace and id=p_id returning version into new_version;
  else
    if p_revision <> 0 then raise exception 'Agent changed or not found' using errcode='PT409'; end if;
    insert into public.agents(id,workspace_id,name,description,goal,language,reply_policy,knowledge,status)
      values(p_id,p_workspace,p_config->>'name',coalesce(p_config->>'description',''),coalesce(p_config->>'goal',''),coalesce(p_config->>'language','English'),coalesce(p_config->>'replyPolicy','positive'),coalesce(p_config->>'knowledge',''),p_config->>'status') returning version into new_version;
  end if;
  if p_config->>'status' = 'active' then
    insert into public.agent_versions(workspace_id,agent_id,version,configuration)
      select workspace_id,id,version,jsonb_build_object('name',name,'goal',goal,'language',language,'replyPolicy',reply_policy,'knowledge',knowledge)
      from public.agents where workspace_id=p_workspace and id=p_id;
  end if;
  return new_version;
end;
$$;
revoke all on function public.save_agent(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_agent(uuid,uuid,integer,jsonb) to authenticated;

create function public.save_note(p_workspace uuid,p_id uuid,p_revision integer,p_notes text)
returns integer language plpgsql security definer set search_path = '' as $$
declare next_revision integer;
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_notes is null or length(p_notes)>8000 then raise exception 'Invalid note' using errcode='22023'; end if;
  update public.conversations set notes=p_notes,notes_revision=notes_revision+1 where workspace_id=p_workspace and id=p_id and notes_revision=p_revision returning notes_revision into next_revision;
  if next_revision is null then raise exception 'Note changed; reload before saving' using errcode='PT409'; end if;
  return next_revision;
end;
$$;
revoke all on function public.save_note(uuid,uuid,integer,text) from public,anon;
grant execute on function public.save_note(uuid,uuid,integer,text) to authenticated;

create function public.act_on_draft(p_workspace uuid,p_id uuid,p_revision integer,p_action text,p_body text default null,p_until timestamptz default null,p_remember boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare d public.drafts; a public.agents; new_status text; new_body text;
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_action is null or p_action not in ('edit','dismiss','snooze','restore','answer') then raise exception 'Invalid action' using errcode='22023'; end if;
  select * into d from public.drafts where workspace_id=p_workspace and id=p_id for update;
  if not found or d.revision<>p_revision or d.status not in ('ready','needs_input','snoozed') then raise exception 'Draft changed; reload before continuing' using errcode='PT409'; end if;
  if p_action='answer' and d.status <> 'needs_input' then raise exception 'Draft no longer needs input' using errcode='PT409'; end if;
  if p_action in ('edit','answer') and (p_body is null or length(btrim(p_body)) not between 1 and 8000) then raise exception 'Invalid reply' using errcode='22023'; end if;
  if p_action='edit' and d.status='needs_input' then raise exception 'Supply the missing answer first' using errcode='22023'; end if;
  if p_action='snooze' and (p_until is null or p_until<=now()) then raise exception 'Choose a future time' using errcode='22023'; end if;
  if p_remember and p_action='answer' then
    if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Only admins may update Knowledge' using errcode='42501'; end if;
    select * into a from public.agents where workspace_id=p_workspace and id=d.agent_id for update;
    update public.agents set knowledge=knowledge||E'\n\n'||btrim(p_body) where workspace_id=p_workspace and id=a.id;
    if a.status='active' then
      insert into public.agent_versions(workspace_id,agent_id,version,configuration)
        select workspace_id,id,version,jsonb_build_object('name',name,'goal',goal,'language',language,'replyPolicy',reply_policy,'knowledge',knowledge) from public.agents where workspace_id=p_workspace and id=a.id;
    end if;
  end if;
  new_body := case when p_action in ('edit','answer') then btrim(p_body) else d.body end;
  new_status := case p_action when 'dismiss' then 'dismissed' when 'snooze' then 'snoozed' when 'answer' then 'ready' when 'restore' then case when d.missing_knowledge is not null then 'needs_input' else 'ready' end else d.status end;
  update public.drafts set body=new_body,status=new_status,revision=revision+1,
    missing_knowledge=case when p_action='answer' then null else missing_knowledge end,
    snoozed_until=case when p_action='snooze' then p_until else null end
    where workspace_id=p_workspace and id=p_id;
  return d.revision+1;
end;
$$;
revoke all on function public.act_on_draft(uuid,uuid,integer,text,text,timestamptz,boolean) from public,anon;
grant execute on function public.act_on_draft(uuid,uuid,integer,text,text,timestamptz,boolean) to authenticated;

create function public.wake_due_drafts(p_workspace uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare total integer;
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  update public.drafts set status=case when missing_knowledge is null then 'ready' else 'needs_input' end,snoozed_until=null,revision=revision+1 where workspace_id=p_workspace and status='snoozed' and snoozed_until<=now();
  get diagnostics total = row_count;
  return total;
end;
$$;
revoke all on function public.wake_due_drafts(uuid) from public,anon;
grant execute on function public.wake_due_drafts(uuid) to authenticated;

create function public.list_workspace_members(p_workspace uuid)
returns table(workspace_id uuid,user_id uuid,role text,name text,email text)
language sql stable security definer set search_path = '' as $$
  select m.workspace_id,m.user_id,m.role,coalesce(nullif(u.raw_user_meta_data->>'name',''),split_part(u.email,'@',1)),u.email
  from public.workspace_members m join auth.users u on u.id=m.user_id
  where m.workspace_id=p_workspace and app_private.has_role(p_workspace) order by m.created_at,m.user_id limit 200;
$$;
revoke all on function public.list_workspace_members(uuid) from public,anon;
grant execute on function public.list_workspace_members(uuid) to authenticated;

create function public.conversation_page(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c where c.workspace_id=p_workspace and not c.archived
    and (p_query='' or c.contact_name ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or c.contact_company ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%')
    and (p_label is null or p_label=any(c.labels))
    and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
  order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.conversation_page(uuid,text,text,timestamptz,uuid,integer) from public,anon;
grant execute on function public.conversation_page(uuid,text,text,timestamptz,uuid,integer) to authenticated;

create function public.conversation_previews(p_workspace uuid,p_ids uuid[])
returns setof public.messages language sql stable security invoker set search_path = '' as $$
  select m.* from public.conversations c cross join lateral (
    select * from public.messages m where m.workspace_id=c.workspace_id and m.conversation_id=c.id order by m.occurred_at desc,m.id desc limit 1
  ) m where c.workspace_id=p_workspace and c.id=any(p_ids[1:200]);
$$;
revoke all on function public.conversation_previews(uuid,uuid[]) from public,anon;
grant execute on function public.conversation_previews(uuid,uuid[]) to authenticated;

-- Trusted server integrations use a server-only key. Browser roles retain the narrow grants above.
grant select on public.workspaces,public.workspace_members,public.agents,public.agent_versions to service_role;
grant select,insert,update on public.connections,public.conversations,public.messages,public.drafts to service_role;
