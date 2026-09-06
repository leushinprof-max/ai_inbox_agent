alter table public.senders add column agent_id uuid;
alter table public.senders add constraint sender_agent_workspace_fk foreign key(workspace_id,agent_id) references public.agents(workspace_id,id);
alter table public.workspaces add column agent_assignment_revision integer not null default 0;

-- Prefer an explicit assignment even when paused; do not silently fall back.
create function app_private.resolve_sender_agent(p_workspace uuid,p_conversation uuid) returns uuid
language sql stable set search_path='' as $$
 select a.id from public.conversations c
 join public.workspaces w on w.id=c.workspace_id
 left join public.senders s on s.workspace_id=c.workspace_id and s.provider_id=c.sender_id
 join public.agents a on a.workspace_id=c.workspace_id and a.id=coalesce(s.agent_id,w.default_agent_id) and a.status='active'
 where c.workspace_id=p_workspace and c.id=p_conversation;
$$;
revoke all on function app_private.resolve_sender_agent(uuid,uuid) from public,anon,authenticated;

create function public.server_resolve_agent(p_workspace uuid,p_conversation uuid) returns uuid
language sql stable security definer set search_path='' as $$ select app_private.resolve_sender_agent(p_workspace,p_conversation); $$;
revoke all on function public.server_resolve_agent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.server_resolve_agent(uuid,uuid) to service_role;

create function app_private.bump_sender_assignment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.agent_id is distinct from old.agent_id then
  update public.workspaces set agent_assignment_revision=agent_assignment_revision+1 where id=new.workspace_id;
 end if;
 return new;
end;$$;
create trigger sender_assignment_revision after update of agent_id on public.senders for each row execute function app_private.bump_sender_assignment();
create function app_private.bump_default_assignment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.default_agent_id is distinct from old.default_agent_id then new.agent_assignment_revision=old.agent_assignment_revision+1;end if;
 return new;
end;$$;
create trigger default_assignment_revision before update of default_agent_id on public.workspaces for each row execute function app_private.bump_default_assignment();

create function public.save_sender_assignments(p_workspace uuid,p_agent uuid,p_senders bigint[],p_default boolean,p_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare current_revision integer;
begin
 select agent_assignment_revision into current_revision from public.workspaces where id=p_workspace for update;
 if not found or not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501';end if;
 if current_revision is distinct from p_revision then raise exception 'Assignments changed. Reload and review the current assignments.' using errcode='PT409';end if;
 if not exists(select 1 from public.agents where workspace_id=p_workspace and id=p_agent) then raise exception 'Agent not found' using errcode='42501';end if;
 if p_senders is null or p_default is null or cardinality(p_senders)>1000 or exists(select 1 from unnest(p_senders) v where v is null or not exists(select 1 from public.senders where workspace_id=p_workspace and provider_id=v)) then raise exception 'Invalid sender selection' using errcode='22023';end if;
 update public.senders set agent_id=null where workspace_id=p_workspace and agent_id=p_agent and not(provider_id=any(p_senders));
 update public.senders set agent_id=p_agent where workspace_id=p_workspace and provider_id=any(p_senders) and agent_id is distinct from p_agent;
 update public.workspaces set default_agent_id=case when p_default then p_agent else null end
 where id=p_workspace and (p_default or default_agent_id=p_agent);
end;$$;
revoke all on function public.save_sender_assignments(uuid,uuid,bigint[],boolean,integer) from public,anon;
grant execute on function public.save_sender_assignments(uuid,uuid,bigint[],boolean,integer) to authenticated;

create or replace function public.server_apply_intent(p_workspace uuid,p_conversation uuid,p_revision integer,p_assignment integer,p_catalog integer,p_config bigint,p_result jsonb,p_agent uuid,p_agent_version integer,p_generate boolean,p_run uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.conversations;l public.workspace_labels;v_label uuid;v_evidence uuid;current_config bigint;answered boolean;eligible boolean;
begin
 select version_id into current_config from public.ai_config_release where singleton for share;
 if current_config is distinct from p_config then raise exception 'Configuration changed' using errcode='PT409';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if not exists(select 1 from public.workspaces where id=p_workspace and label_revision=p_catalog) then raise exception 'Catalog changed' using errcode='PT409';end if;
 select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation for update;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 if p_run is not null and not exists(select 1 from public.import_runs where workspace_id=p_workspace and id=p_run and status in ('queued','running')) then return false;end if;
 if c.inbound_revision=0 then
  if p_run is not null then update app_private.import_items set skipped=true,classified=false where workspace_id=p_workspace and run_id=p_run and conversation_id=c.id;perform app_private.update_import_progress(p_run);end if;
  return false;
 end if;
 if c.inbound_revision<>p_revision or c.label_assignment_revision<>p_assignment or (c.label_source='manual' and c.classified_revision=p_revision) then
  if p_run is not null then update app_private.import_items set classified=true where workspace_id=p_workspace and run_id=p_run and conversation_id=c.id;perform app_private.update_import_progress(p_run);end if;
  return false;
 end if;
 if app_private.resolve_sender_agent(p_workspace,p_conversation) is distinct from p_agent or (p_agent is not null and not exists(select 1 from public.agents where workspace_id=p_workspace and id=p_agent and version=p_agent_version and status='active')) then raise exception 'Agent changed' using errcode='PT409';end if;
 v_label=(p_result->>'labelId')::uuid;v_evidence=(p_result->>'evidenceMessageId')::uuid;
 if v_label is not null then
  select * into l from public.workspace_labels where workspace_id=p_workspace and id=v_label and enabled and not archived;
  if not found then raise exception 'Invalid label' using errcode='22023';end if;
  if nullif(btrim(p_result->>'evidenceQuote'),'') is null or length(p_result->>'evidenceQuote')>8000 or not exists(select 1 from public.messages where workspace_id=p_workspace and conversation_id=c.id and id=v_evidence and direction='inbound' and position(p_result->>'evidenceQuote' in body)>0) then raise exception 'Invalid evidence' using errcode='22023';end if;
 elsif v_evidence is not null or coalesce(p_result->>'evidenceQuote','')<>'' then raise exception 'Invalid evidence' using errcode='22023';end if;
 select direction='outbound' into answered from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1;
 eligible=p_generate and v_label is not null and not coalesce(answered,true) and not coalesce((p_result->>'contactStopped')::boolean,false) and exists(select 1 from public.agents a  where a.workspace_id=p_workspace and a.id=p_agent and a.id=app_private.resolve_sender_agent(p_workspace,p_conversation) and a.version=p_agent_version and a.status='active' and l.intent_group=any(a.reply_groups));
 update public.conversations set label_id=v_label,label_source='ai',label_state=case when v_label is null then 'uncategorized' else 'classified' end,classified_revision=p_revision,
 label_assignment_revision=label_assignment_revision+1,evidence_message_id=v_evidence,evidence_quote=coalesce(p_result->>'evidenceQuote',''),contact_stopped=coalesce((p_result->>'contactStopped')::boolean,false),
 no_reply_reason=case when eligible and not coalesce((p_result->>'shouldReply')::boolean,false) then left(coalesce(p_result->>'noReplyReason',''),1000) else '' end,
 reply_decision_revision=p_revision,reply_agent_id=p_agent,reply_agent_version=p_agent_version,reply_catalog_revision=p_catalog,reply_config_version=p_config
 where workspace_id=p_workspace and id=c.id;
 if eligible and (p_result->>'shouldReply')::boolean and (nullif(btrim(p_result->>'draft'),'') is not null or nullif(btrim(p_result->>'missingKnowledge'),'') is not null) then
  update public.drafts set status='dismissed',revision=revision+1 where workspace_id=p_workspace and conversation_id=c.id and source_revision<p_revision and status in ('ready','needs_input','snoozed');
  insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,missing_knowledge)
  values(p_workspace,c.id,p_agent,p_agent_version,coalesce(p_result->>'draft',''),case when nullif(btrim(p_result->>'missingKnowledge'),'') is null then 'ready' else 'needs_input' end,p_revision,nullif(btrim(p_result->>'missingKnowledge'),''))
  on conflict(workspace_id,conversation_id) where status in ('ready','needs_input','snoozed') do nothing;
 end if;
 if p_run is not null then update app_private.import_items set classified=true where workspace_id=p_workspace and run_id=p_run and conversation_id=c.id;perform app_private.update_import_progress(p_run);end if;
 return true;
end;$$;

create or replace function public.request_draft_generation(p_workspace uuid,p_id uuid,p_conversation uuid,p_source_revision integer,p_draft uuid default null,p_revision integer default null,p_instructions text default '',p_answer text default '',p_remember boolean default false)
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
  select * into a from public.agents where workspace_id=p_workspace and id=app_private.resolve_sender_agent(p_workspace,p_conversation);
  if not found then raise exception 'Assign an active agent to this sender or select a workspace default first' using errcode='22023'; end if;
  if c.contact_stopped or not exists(select 1 from public.workspace_labels where workspace_id=p_workspace and id=c.label_id and enabled and not archived and intent_group=any(a.reply_groups)) or (select direction from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1) is distinct from 'inbound' then raise exception 'Reply is not eligible' using errcode='22023';end if;
  select * into d from public.drafts where workspace_id=p_workspace and conversation_id=p_conversation and status in ('ready','needs_input','snoozed') for update;
  if (d.id is not null and (d.id is distinct from p_draft or d.revision is distinct from p_revision)) or (d.id is null and p_draft is not null) then raise exception 'Draft changed; reload before generating' using errcode='PT409'; end if;
  if p_remember then
    if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Only admins may update Knowledge' using errcode='42501'; end if;
    if nullif(btrim(p_answer),'') is null then raise exception 'Provide an approved answer' using errcode='22023'; end if;
    update public.agents set knowledge=knowledge||E'\n\n'||btrim(p_answer) where workspace_id=p_workspace and id=a.id returning * into a;
    insert into public.agent_versions(workspace_id,agent_id,version,configuration) values(p_workspace,a.id,a.version,jsonb_build_object('name',a.name,'goal',a.goal,'language',a.language,'replyGroups',to_jsonb(a.reply_groups),'knowledge',a.knowledge));
  end if;
  if (select count(*) from public.draft_generations where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=100 then raise exception 'Generation limit reached. Try again later' using errcode='22023'; end if;
  insert into public.draft_generations(workspace_id,id,conversation_id,user_id,agent_id,agent_version,source_revision,expected_draft_id,expected_draft_revision,instructions,approved_answer)
    values(p_workspace,p_id,p_conversation,auth.uid(),a.id,a.version,c.inbound_revision,d.id,d.revision,p_instructions,p_answer);
  insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'generate',p_id::text,jsonb_build_object('generationId',p_id));
  return p_id;
end;
$$;

create or replace function public.server_complete_generation_v2(p_workspace uuid,p_id uuid,p_body text,p_missing text,p_should_reply boolean,p_config bigint,p_catalog integer,p_assignment integer,p_reason text,p_stopped boolean)
returns void language plpgsql security definer set search_path='' as $$
declare g public.draft_generations; c public.conversations; d public.drafts; failure text; new_id uuid; latest_direction text;
begin
  perform 1 from public.ai_config_release where singleton and version_id=p_config for share;
  if not found then raise exception 'Configuration changed' using errcode='PT409';end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id for update;
  if not found or g.status<>'queued' then return; end if;
  select * into c from public.conversations where workspace_id=p_workspace and id=g.conversation_id for update;
  if not exists(select 1 from public.workspaces where id=p_workspace and label_revision=p_catalog) then raise exception 'Catalog changed' using errcode='PT409';end if;
  if c.label_assignment_revision<>p_assignment then raise exception 'Assignment changed' using errcode='PT409';end if;
  select * into d from public.drafts where workspace_id=p_workspace and conversation_id=c.id and status in ('ready','needs_input','snoozed') for update;
  select direction into latest_direction from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1;
  if c.inbound_revision<>g.source_revision or d.id is distinct from g.expected_draft_id or d.revision is distinct from g.expected_draft_revision then failure='context_changed';
  elsif latest_direction is distinct from 'inbound' then failure='context_changed';
  elsif not exists(select 1 from public.workspace_labels l join public.agents a on a.workspace_id=l.workspace_id where l.workspace_id=p_workspace and l.id=c.label_id and l.enabled and not l.archived and a.id=g.agent_id and l.intent_group=any(a.reply_groups)) then failure='label_not_eligible';
  elsif not exists(select 1 from public.agents where workspace_id=p_workspace and id=g.agent_id and version=g.agent_version and status='active') or app_private.resolve_sender_agent(p_workspace,g.conversation_id) is distinct from g.agent_id then failure='agent_changed';
  elsif p_should_reply and not p_stopped and nullif(btrim(p_body),'') is null and nullif(btrim(p_missing),'') is null then failure='model_invalid_response';
  end if;
  if failure is not null then update public.draft_generations set status='failed',error_code=failure,updated_at=now() where workspace_id=p_workspace and id=p_id;return;end if;
  update public.conversations set contact_stopped=p_stopped,no_reply_reason=case when not p_should_reply and not p_stopped then left(p_reason,1000) else '' end,reply_decision_revision=c.inbound_revision,reply_agent_id=g.agent_id,reply_agent_version=g.agent_version,reply_catalog_revision=p_catalog,reply_config_version=p_config where workspace_id=p_workspace and id=c.id;
  if not p_should_reply or p_stopped then update public.draft_generations set status='completed',error_code='no_reply_needed',updated_at=now() where workspace_id=p_workspace and id=p_id;return;end if;
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
