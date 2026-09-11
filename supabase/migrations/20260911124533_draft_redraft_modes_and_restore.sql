-- Existing callers remain supported. New requests explicitly distinguish a
-- fresh answer from editing the text currently visible to the reviewer.
alter table public.draft_generations
  add column generation_mode text check (generation_mode in ('reply', 'rewrite')),
  add column current_draft text check (length(current_draft) <= 8000);
alter table public.drafts add column previous_version jsonb;

create function public.request_draft_generation_v2(
  p_workspace uuid, p_id uuid, p_conversation uuid, p_source_revision integer,
  p_draft uuid default null, p_revision integer default null,
  p_instructions text default '', p_answer text default '',
  p_mode text default 'reply', p_current_draft text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.draft_generations; result uuid;
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  if p_mode is null or p_mode not in ('reply','rewrite') or p_instructions is null or p_answer is null
     or length(p_current_draft)>8000 then raise exception 'Invalid generation request' using errcode='22023'; end if;
  if p_mode='reply' and btrim(p_instructions)<>'' then raise exception 'Fresh replies do not use rewrite instructions' using errcode='22023'; end if;
  if p_mode='rewrite' and (p_draft is null or nullif(btrim(p_instructions),'') is null
     or nullif(btrim(p_current_draft),'') is null or btrim(p_answer)<>'') then
    raise exception 'Provide the current draft and instructions' using errcode='22023';
  end if;
  select * into existing from public.draft_generations where workspace_id=p_workspace and id=p_id;
  if found then
    if existing.user_id is distinct from auth.uid() or existing.conversation_id is distinct from p_conversation
       or existing.source_revision is distinct from p_source_revision or existing.expected_draft_id is distinct from p_draft
       or existing.expected_draft_revision is distinct from p_revision or existing.instructions is distinct from p_instructions
       or existing.approved_answer is distinct from p_answer or existing.generation_mode is distinct from p_mode
       or existing.current_draft is distinct from p_current_draft then
      raise exception 'Request identity changed' using errcode='PT409';
    end if;
    return existing.id;
  end if;
  if p_mode='rewrite' and not exists(select 1 from public.drafts where workspace_id=p_workspace
      and id=p_draft and conversation_id=p_conversation and revision=p_revision
      and source_revision=p_source_revision and status in ('ready','snoozed')) then
    raise exception 'Draft context changed; generate a fresh reply first' using errcode='PT409';
  end if;
  result=public.request_draft_generation(p_workspace,p_id,p_conversation,p_source_revision,p_draft,p_revision,p_instructions,p_answer,false);
  update public.draft_generations set generation_mode=p_mode,current_draft=p_current_draft where workspace_id=p_workspace and id=result;
  return result;
end;$$;
revoke all on function public.request_draft_generation_v2(uuid,uuid,uuid,integer,uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.request_draft_generation_v2(uuid,uuid,uuid,integer,uuid,integer,text,text,text,text) to authenticated;

-- Capture the previous version only when a generation actually succeeds.
-- Cancelled, failed and superseded requests cannot replace the undo target.
create or replace function public.server_complete_generation_v3(
 p_workspace uuid,p_id uuid,p_body text,p_missing text,p_config bigint,p_catalog integer,p_assignment integer,p_run_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare stopped boolean; g public.draft_generations; d public.drafts; previous jsonb; previous_body text;
begin
 perform 1 from public.ai_config_release where singleton and version_id=p_config for share;
 if not found then raise exception 'Configuration changed' using errcode='PT409';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id for update;
 if not found or g.status<>'queued' then return;end if;
 select contact_stopped into stopped from public.conversations where workspace_id=p_workspace and id=g.conversation_id for update;
 if (nullif(btrim(p_body),'') is null) = (nullif(btrim(p_missing),'') is null) then raise exception 'Invalid writer response' using errcode='22023';end if;
 if p_run_id is not null and not exists(select 1 from public.ai_runs where workspace_id=p_workspace and id=p_run_id and conversation_id=g.conversation_id and agent_id=g.agent_id and agent_version=g.agent_version and configuration_version=p_config and status='completed') then raise exception 'Invalid AI run' using errcode='22023';end if;
 select * into d from public.drafts where workspace_id=p_workspace and id=g.expected_draft_id for update;
 if found then
   previous_body=coalesce(g.current_draft,d.body);
   -- A cleared editor has no previous message to restore. A needs-input state
   -- can be restored along with its question, without inventing a reply.
   if nullif(btrim(previous_body),'') is not null or d.missing_knowledge is not null then
     previous=jsonb_build_object('body',previous_body,'source_revision',d.source_revision,
       'agent_id',d.agent_id,'agent_version',d.agent_version,'ai_run_id',d.ai_run_id,
       'missing_knowledge',d.missing_knowledge);
   end if;
 end if;
 perform public.server_complete_generation_v2(p_workspace,p_id,p_body,p_missing,true,p_config,p_catalog,p_assignment,'',coalesce(stopped,false));
 select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id;
 if g.status='completed' and g.result_draft_id is not null then
   update public.drafts set ai_run_id=p_run_id,previous_version=previous where workspace_id=p_workspace and id=g.result_draft_id;
 end if;
end;$$;

create function public.restore_previous_draft(p_workspace uuid,p_id uuid,p_revision integer)
returns integer language plpgsql security definer set search_path='' as $$
declare d public.drafts; c public.conversations; previous jsonb;
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into c from public.conversations where workspace_id=p_workspace and id=(select conversation_id from public.drafts where workspace_id=p_workspace and id=p_id) for update;
 select * into d from public.drafts where workspace_id=p_workspace and id=p_id for update;
 if not found or d.revision is distinct from p_revision or d.status not in ('ready','needs_input','snoozed') or d.previous_version is null then
   raise exception 'Draft changed; reload before restoring' using errcode='PT409';
 end if;
 previous=d.previous_version;
 if c.inbound_revision is distinct from (previous->>'source_revision')::integer or c.contact_stopped
    or (select direction from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1) is distinct from 'inbound'
    or exists(select 1 from public.draft_generations where workspace_id=p_workspace and conversation_id=c.id and status='queued') then
   raise exception 'Conversation changed; review it before restoring' using errcode='PT409';
 end if;
 update public.drafts set body=previous->>'body',source_revision=(previous->>'source_revision')::integer,
   agent_id=(previous->>'agent_id')::uuid,agent_version=(previous->>'agent_version')::integer,
   ai_run_id=(previous->>'ai_run_id')::uuid,missing_knowledge=previous->>'missing_knowledge',
   status=case when previous->>'missing_knowledge' is null then 'ready' else 'needs_input' end,
   snoozed_until=null,previous_version=null,revision=revision+1
 where workspace_id=p_workspace and id=p_id;
 return d.revision+1;
end;$$;
revoke all on function public.restore_previous_draft(uuid,uuid,integer) from public,anon;
grant execute on function public.restore_previous_draft(uuid,uuid,integer) to authenticated;
