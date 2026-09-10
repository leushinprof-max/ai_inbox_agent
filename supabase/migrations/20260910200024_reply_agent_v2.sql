-- Preserve legacy rows and snapshots. Background v2 uses the existing versioned knowledge field.
alter table public.agents drop constraint agents_knowledge_check;
alter table public.agents add constraint agents_knowledge_check check(length(knowledge)<=64000);
alter table public.agents drop constraint agents_custom_instructions_check;
alter table public.agents add constraint agents_custom_instructions_check check(length(custom_instructions)<=10002);

-- Exact request bodies, without HTTP headers. Existing AI run permissions apply.
alter table public.ai_runs add column request_snapshot jsonb, add column request_context jsonb, add column result_snapshot jsonb;
alter table public.ai_runs add constraint ai_runs_workspace_id_id_key unique(workspace_id,id);
alter table public.drafts add column ai_run_id uuid,
 add constraint drafts_ai_run_fkey foreign key(workspace_id,ai_run_id) references public.ai_runs(workspace_id,id);
create index drafts_ai_run_idx on public.drafts(workspace_id,ai_run_id) where ai_run_id is not null;

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
  insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,missing_knowledge,ai_run_id)
  values(p_workspace,c.id,p_agent,p_agent_version,coalesce(p_result->>'draft',''),case when nullif(btrim(p_result->>'missingKnowledge'),'') is null then 'ready' else 'needs_input' end,p_revision,nullif(btrim(p_result->>'missingKnowledge'),''),nullif(p_result->>'runId','')::uuid)
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
  if p_remember then raise exception 'Edit permanent information in Agents' using errcode='22023';end if;
  if (select count(*) from public.draft_generations where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=100 then raise exception 'Generation limit reached. Try again later' using errcode='22023'; end if;
  insert into public.draft_generations(workspace_id,id,conversation_id,user_id,agent_id,agent_version,source_revision,expected_draft_id,expected_draft_revision,instructions,approved_answer)
    values(p_workspace,p_id,p_conversation,auth.uid(),a.id,a.version,c.inbound_revision,d.id,d.revision,p_instructions,p_answer);
  insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'generate',p_id::text,jsonb_build_object('generationId',p_id));
  return p_id;
end;
$$;

create or replace function public.act_on_draft(p_workspace uuid,p_id uuid,p_revision integer,p_action text,p_body text default null,p_until timestamptz default null,p_remember boolean default false)
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
  if p_remember then raise exception 'Edit permanent information in Agents' using errcode='22023';end if;
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


-- New writers always return a draft or a question. Stop state belongs to classification.
create function public.server_complete_generation_v3(
 p_workspace uuid,p_id uuid,p_body text,p_missing text,p_config bigint,p_catalog integer,p_assignment integer,p_run_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare stopped boolean; g public.draft_generations;
begin
 perform 1 from public.ai_config_release where singleton and version_id=p_config for share;
 if not found then raise exception 'Configuration changed' using errcode='PT409';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id for update;
 if not found or g.status<>'queued' then return;end if;
 select contact_stopped into stopped from public.conversations where workspace_id=p_workspace and id=g.conversation_id for update;
 if (nullif(btrim(p_body),'') is null) = (nullif(btrim(p_missing),'') is null) then raise exception 'Invalid writer response' using errcode='22023';end if;
 if p_run_id is not null and not exists(select 1 from public.ai_runs where workspace_id=p_workspace and id=p_run_id and conversation_id=g.conversation_id and agent_id=g.agent_id and agent_version=g.agent_version and configuration_version=p_config and status='completed') then raise exception 'Invalid AI run' using errcode='22023';end if;
 perform public.server_complete_generation_v2(p_workspace,p_id,p_body,p_missing,true,p_config,p_catalog,p_assignment,'',coalesce(stopped,false));
 select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id;
 if g.status='completed' and g.result_draft_id is not null then
  update public.drafts set ai_run_id=p_run_id where workspace_id=p_workspace and id=g.result_draft_id;
 end if;
end;$$;
revoke all on function public.server_complete_generation_v3(uuid,uuid,text,text,bigint,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.server_complete_generation_v3(uuid,uuid,text,text,bigint,integer,integer,uuid) to service_role;
