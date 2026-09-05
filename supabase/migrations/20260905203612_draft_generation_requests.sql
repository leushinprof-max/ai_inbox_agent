alter table app_private.jobs drop constraint jobs_kind_check;
alter table app_private.jobs add constraint jobs_kind_check check(kind in ('sync','import','classify','reconcile_send','generate'));
create table public.draft_generations (
  workspace_id uuid not null,id uuid not null,conversation_id uuid not null,user_id uuid not null references auth.users(id),
  agent_id uuid not null,agent_version integer not null,source_revision integer not null,
  expected_draft_id uuid,expected_draft_revision integer,instructions text not null default '',approved_answer text not null default '',
  status text not null default 'queued' check(status in ('queued','completed','failed','cancelled')),
  error_code text,result_draft_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  primary key(workspace_id,id),foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id),
  foreign key(workspace_id,agent_id,agent_version) references public.agent_versions(workspace_id,agent_id,version),
  foreign key(workspace_id,expected_draft_id) references public.drafts(workspace_id,id),
  foreign key(workspace_id,result_draft_id) references public.drafts(workspace_id,id)
);
create unique index one_active_generation on public.draft_generations(workspace_id,conversation_id) where status='queued';
create index generation_recent_idx on public.draft_generations(workspace_id,created_at desc);
alter table public.draft_generations enable row level security;
revoke all on public.draft_generations from public,anon,authenticated;
grant select on public.draft_generations to authenticated;
grant select,insert,update on public.draft_generations to service_role;
create policy generation_read on public.draft_generations for select to authenticated using(app_private.has_role(workspace_id));

create function public.request_draft_generation(p_workspace uuid,p_id uuid,p_conversation uuid,p_source_revision integer,p_draft uuid default null,p_revision integer default null,p_instructions text default '',p_answer text default '',p_remember boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.conversations; a public.agents; d public.drafts; existing public.draft_generations;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if length(p_instructions)>2000 or length(p_answer)>8000 then raise exception 'Input too long' using errcode='22023'; end if;
  select * into existing from public.draft_generations where workspace_id=p_workspace and id=p_id;
  if found then
    if existing.user_id<>auth.uid() or existing.conversation_id<>p_conversation or existing.instructions<>p_instructions or existing.approved_answer<>p_answer then raise exception 'Request identity changed' using errcode='PT409'; end if;
    return existing.id;
  end if;
  select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation for update;
  if not found or c.inbound_revision<>p_source_revision then raise exception 'Conversation changed; review it before generating' using errcode='PT409'; end if;
  select a1.* into a from public.agents a1 join public.workspaces w on w.id=a1.workspace_id and w.default_agent_id=a1.id where w.id=p_workspace and a1.status='active';
  if not found then raise exception 'Select an active agent for workspace replies first' using errcode='22023'; end if;
  select * into d from public.drafts where workspace_id=p_workspace and conversation_id=p_conversation and status in ('ready','needs_input','snoozed') for update;
  if (d.id is not null and (d.id is distinct from p_draft or d.revision is distinct from p_revision)) or (d.id is null and p_draft is not null) then raise exception 'Draft changed; reload before generating' using errcode='PT409'; end if;
  if p_remember then
    if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Only admins may update Knowledge' using errcode='42501'; end if;
    if nullif(btrim(p_answer),'') is null then raise exception 'Provide an approved answer' using errcode='22023'; end if;
    update public.agents set knowledge=knowledge||E'\n\n'||btrim(p_answer) where workspace_id=p_workspace and id=a.id returning * into a;
    insert into public.agent_versions(workspace_id,agent_id,version,configuration) values(p_workspace,a.id,a.version,jsonb_build_object('name',a.name,'goal',a.goal,'language',a.language,'replyPolicy',a.reply_policy,'knowledge',a.knowledge));
  end if;
  if (select count(*) from public.draft_generations where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=100 then raise exception 'Generation limit reached. Try again later' using errcode='22023'; end if;
  insert into public.draft_generations(workspace_id,id,conversation_id,user_id,agent_id,agent_version,source_revision,expected_draft_id,expected_draft_revision,instructions,approved_answer)
    values(p_workspace,p_id,p_conversation,auth.uid(),a.id,a.version,c.inbound_revision,d.id,d.revision,p_instructions,p_answer);
  insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'generate',p_id::text,jsonb_build_object('generationId',p_id));
  return p_id;
end;
$$;
revoke all on function public.request_draft_generation(uuid,uuid,uuid,integer,uuid,integer,text,text,boolean) from public,anon;
grant execute on function public.request_draft_generation(uuid,uuid,uuid,integer,uuid,integer,text,text,boolean) to authenticated;

create function public.cancel_draft_generation(p_workspace uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  update public.draft_generations set status='cancelled',updated_at=now() where workspace_id=p_workspace and id=p_id and status='queued';
end;
$$;
revoke all on function public.cancel_draft_generation(uuid,uuid) from public,anon;
grant execute on function public.cancel_draft_generation(uuid,uuid) to authenticated;

create function public.server_complete_generation(p_workspace uuid,p_id uuid,p_body text,p_missing text,p_should_reply boolean)
returns void language plpgsql security definer set search_path='' as $$
declare g public.draft_generations; c public.conversations; d public.drafts; failure text; new_id uuid; latest_direction text;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id for update;
  if not found or g.status<>'queued' then return; end if;
  select * into c from public.conversations where workspace_id=p_workspace and id=g.conversation_id for update;
  select * into d from public.drafts where workspace_id=p_workspace and conversation_id=c.id and status in ('ready','needs_input','snoozed') for update;
  select direction into latest_direction from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1;
  if c.inbound_revision<>g.source_revision or d.id is distinct from g.expected_draft_id or d.revision is distinct from g.expected_draft_revision then failure='context_changed';
  elsif latest_direction is distinct from 'inbound' or not p_should_reply then failure='no_reply_needed';
  elsif not exists(select 1 from public.agents where workspace_id=p_workspace and id=g.agent_id and version=g.agent_version and status='active') or not exists(select 1 from public.workspaces where id=p_workspace and default_agent_id=g.agent_id) then failure='agent_changed';
  elsif nullif(btrim(p_body),'') is null and nullif(btrim(p_missing),'') is null then failure='model_invalid_response';
  end if;
  if failure is not null then update public.draft_generations set status='failed',error_code=failure,updated_at=now() where workspace_id=p_workspace and id=p_id;return;end if;
  if d.id is not null then
    update public.drafts set body=coalesce(p_body,''),missing_knowledge=nullif(btrim(p_missing),''),status=case when nullif(btrim(p_missing),'') is null then 'ready' else 'needs_input' end,
      source_revision=g.source_revision,agent_id=g.agent_id,agent_version=g.agent_version,revision=revision+1,snoozed_until=null where workspace_id=p_workspace and id=d.id returning id into new_id;
  else
    insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,missing_knowledge)
      values(p_workspace,c.id,g.agent_id,g.agent_version,coalesce(p_body,''),case when nullif(btrim(p_missing),'') is null then 'ready' else 'needs_input' end,g.source_revision,nullif(btrim(p_missing),'')) returning id into new_id;
  end if;
  update public.draft_generations set status='completed',result_draft_id=new_id,updated_at=now() where workspace_id=p_workspace and id=p_id;
end;
$$;
revoke all on function public.server_complete_generation(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.server_complete_generation(uuid,uuid,text,text,boolean) to service_role;

create function app_private.record_generation_failure() returns trigger language plpgsql set search_path='' as $$
begin
  if new.kind='generate' and new.status='failed' then update public.draft_generations set status='failed',error_code=new.error_code,updated_at=now() where workspace_id=new.workspace_id and id::text=new.payload->>'generationId' and status='queued';end if;
  return new;
end;
$$;
revoke all on function app_private.record_generation_failure() from public,anon,authenticated;
create trigger generation_job_failure after update of status on app_private.jobs for each row execute function app_private.record_generation_failure();
