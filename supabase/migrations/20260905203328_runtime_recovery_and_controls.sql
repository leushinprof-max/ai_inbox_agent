create function public.server_refresh_senders(p_workspace uuid,p_revision integer,p_senders jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_revision) then raise exception 'Connection changed' using errcode='PT409'; end if;
  if jsonb_typeof(p_senders)<>'array' or jsonb_array_length(p_senders)>1000 then raise exception 'Invalid sender list' using errcode='22023'; end if;
  delete from public.senders where workspace_id=p_workspace;
  insert into public.senders(workspace_id,provider_id,name,auth_valid)
    select p_workspace,(s->>'id')::bigint,s->>'name',(s->>'authValid')::boolean from jsonb_array_elements(p_senders) s;
end;
$$;
revoke all on function public.server_refresh_senders(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.server_refresh_senders(uuid,integer,jsonb) to service_role;

create or replace function public.server_claim_job() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j app_private.jobs;
begin
  with exhausted as (
    update app_private.jobs set status='failed',error_code='attempts_exhausted'
      where status='running' and lease_until<now() and attempts>=5 returning workspace_id,payload
  ) update public.import_runs r set status='failed',error_code='attempts_exhausted',updated_at=now()
    from exhausted e where r.workspace_id=e.workspace_id and r.id::text=e.payload->>'runId' and r.status in ('queued','running');
  select * into j from app_private.jobs q where
    (q.status='queued' and q.available_at<=now() or q.status='running' and q.lease_until<now()) and q.attempts<5
    and (nullif(q.payload->>'runId','') is null or exists(select 1 from public.import_runs r where r.id::text=q.payload->>'runId' and r.workspace_id=q.workspace_id and r.status in ('queued','running')))
    order by q.available_at,q.created_at for update skip locked limit 1;
  if not found then return null; end if;
  update app_private.jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=j.id returning * into j;
  return to_jsonb(j);
end;
$$;

create or replace function public.server_finish_job(p_id uuid,p_lease uuid,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j app_private.jobs;
begin
  update app_private.jobs set status=case when p_error is null then 'done'
    when attempts>=5 or p_error in ('model_not_configured','connection_changed','connection_unavailable','provider_unauthorized','sender_not_in_workspace') then 'failed' else 'queued' end,
    error_code=left(p_error,100),available_at=now()+interval '30 seconds'*greatest(attempts,1),lease_until=null
    where id=p_id and lease_token=p_lease and status='running' returning * into j;
  if not found then raise exception 'Lease changed' using errcode='PT409'; end if;
  if j.status='failed' and j.payload->>'runId' is not null then
    update public.import_runs set status='failed',error_code=j.error_code,updated_at=now()
      where workspace_id=j.workspace_id and id::text=j.payload->>'runId' and status in ('queued','running');
  end if;
end;
$$;

create or replace function public.retry_history_import(p_workspace uuid,p_run uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected') then raise exception 'Connect HeyReach first' using errcode='22023'; end if;
  update public.import_runs set status='running',error_code=null,updated_at=now() where workspace_id=p_workspace and id=p_run and status='failed' and error_code is distinct from 'scan_limit';
  if not found then raise exception 'Import cannot be retried' using errcode='PT409'; end if;
  -- Replay the bounded run. Page offsets, message keys and current draft admission are idempotent.
  update app_private.jobs set status='queued',attempts=0,error_code=null,available_at=now(),lease_until=null,lease_token=null,
    payload=case when payload ? 'connectionRevision' then jsonb_set(payload,'{connectionRevision}',to_jsonb((select revision from public.connections where workspace_id=p_workspace))) else payload end
    where workspace_id=p_workspace and payload->>'runId'=p_run::text;
end;
$$;

create function public.cancel_history_import(p_workspace uuid,p_run uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  update public.import_runs set status='cancelled',updated_at=now() where workspace_id=p_workspace and id=p_run and status in ('queued','running','failed');
end;
$$;
revoke all on function public.cancel_history_import(uuid,uuid) from public,anon;
grant execute on function public.cancel_history_import(uuid,uuid) to authenticated;

create function public.resolve_unconfirmed_send(p_workspace uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  update public.send_operations set status='rejected',reason='Manually confirmed absent in HeyReach',updated_at=now()
    where workspace_id=p_workspace and id=p_id and status in ('sending','unknown') and created_at<now()-interval '90 seconds';
  if not found then raise exception 'Check the message status before continuing' using errcode='PT409'; end if;
end;
$$;
revoke all on function public.resolve_unconfirmed_send(uuid,uuid) from public,anon;
grant execute on function public.resolve_unconfirmed_send(uuid,uuid) to authenticated;

create function public.request_send_check(p_workspace uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.send_operations where workspace_id=p_workspace and id=p_id and status in ('sending','unknown') and created_at<now()-interval '90 seconds') then raise exception 'Send status is not available for recheck yet' using errcode='PT409'; end if;
  update app_private.jobs set status='queued',attempts=0,error_code=null,available_at=now(),lease_until=null,lease_token=null
    where workspace_id=p_workspace and kind='reconcile_send' and dedup_key=p_id::text and status<>'running';
end;
$$;
revoke all on function public.request_send_check(uuid,uuid) from public,anon;
grant execute on function public.request_send_check(uuid,uuid) to authenticated;

drop function public.server_apply_classification(uuid,uuid,integer,text[],uuid,integer,text,text,boolean,uuid);
create function public.server_apply_classification(p_workspace uuid,p_conversation uuid,p_revision integer,p_labels text[],p_agent uuid,p_agent_version integer,p_draft text,p_missing text,p_generate boolean,p_run uuid default null,p_connection_revision integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.conversations; current_agent uuid; answered boolean;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_connection_revision) then raise exception 'Connection changed' using errcode='PT409'; end if;
  if p_run is not null and not exists(select 1 from public.import_runs where workspace_id=p_workspace and id=p_run and status in ('queued','running')) then return false; end if;
  select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation for update;
  if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  if c.inbound_revision<>p_revision then
    if p_run is not null then update app_private.import_items set classified=true where workspace_id=p_workspace and run_id=p_run and conversation_id=c.id;perform app_private.update_import_progress(p_run);end if;
    return false;
  end if;
  if not (p_labels <@ array['Interested','Information Request','Meeting Request','Referral','Not interested']) or cardinality(p_labels)>3 then raise exception 'Invalid labels' using errcode='22023'; end if;
  update public.conversations set labels=p_labels,classified_revision=p_revision where workspace_id=p_workspace and id=c.id;
  select default_agent_id into current_agent from public.workspaces where id=p_workspace;
  select direction='outbound' into answered from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1;
  if p_generate and not coalesce(answered,true) and p_agent is not null and current_agent=p_agent and exists(select 1 from public.agents where workspace_id=p_workspace and id=p_agent and version=p_agent_version and status='active') and (nullif(btrim(p_draft),'') is not null or nullif(btrim(p_missing),'') is not null) then
    -- Never overwrite a human-edited current draft; supersede only a draft for older incoming context.
    update public.drafts set status='dismissed',revision=revision+1 where workspace_id=p_workspace and conversation_id=c.id and source_revision<p_revision and status in ('ready','needs_input','snoozed');
    insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,missing_knowledge)
      values(p_workspace,c.id,p_agent,p_agent_version,coalesce(p_draft,''),case when nullif(btrim(p_missing),'') is null then 'ready' else 'needs_input' end,p_revision,nullif(btrim(p_missing),''))
      on conflict(workspace_id,conversation_id) where status in ('ready','needs_input','snoozed') do nothing;
  end if;
  if p_run is not null then update app_private.import_items set classified=true where workspace_id=p_workspace and run_id=p_run and conversation_id=c.id;perform app_private.update_import_progress(p_run);end if;
  return true;
end;
$$;
revoke all on function public.server_apply_classification(uuid,uuid,integer,text[],uuid,integer,text,text,boolean,uuid,integer) from public,anon,authenticated;
grant execute on function public.server_apply_classification(uuid,uuid,integer,text[],uuid,integer,text,text,boolean,uuid,integer) to service_role;

create or replace function public.server_credentials(p_workspace uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ciphertext',c.ciphertext,'webhookHash',c.webhook_hash,'revision',s.revision)
 from app_private.provider_credentials c join public.connections s on s.workspace_id=c.workspace_id where c.workspace_id=p_workspace;
$$;
drop function public.reserve_send(uuid,uuid,uuid,text,uuid,integer,integer);
create function public.reserve_send(p_workspace uuid,p_id uuid,p_conversation uuid,p_body text,p_draft uuid default null,p_revision integer default null,p_source_revision integer default null,p_connection_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations; d public.drafts; op public.send_operations; payload jsonb;
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 8000 then raise exception 'Invalid message' using errcode='22023'; end if;
  payload=jsonb_build_object('conversationId',p_conversation,'body',btrim(p_body),'draftId',p_draft,'revision',p_revision,'sourceRevision',p_source_revision);
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation for update;
  if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  select * into op from public.send_operations where workspace_id=p_workspace and id=p_id;
  if found then
    if op.user_id<>auth.uid() or op.request<>payload then raise exception 'Request already used' using errcode='PT409'; end if;
    return jsonb_build_object('kind','existing','status',op.status,'reason',op.reason);
  end if;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_connection_revision) or not exists(select 1 from public.senders where workspace_id=p_workspace and provider_id=c.sender_id and auth_valid) then raise exception 'Connect the conversation sender' using errcode='22023'; end if;
  if p_draft is not null then
    select * into d from public.drafts where workspace_id=p_workspace and id=p_draft and conversation_id=p_conversation for update;
    if not found or d.status<>'ready' or d.revision is distinct from p_revision or d.source_revision is distinct from p_source_revision or c.inbound_revision<>d.source_revision then raise exception 'Draft context changed' using errcode='PT409'; end if;
  end if;
  if exists(select 1 from public.send_operations where workspace_id=p_workspace and conversation_id=p_conversation and status in ('sending','unknown')) then raise exception 'A previous send needs its status checked' using errcode='PT409'; end if;
  insert into public.send_operations(workspace_id,id,user_id,conversation_id,request,status,source_revision) values(p_workspace,p_id,auth.uid(),p_conversation,payload,'sending',c.inbound_revision);
  insert into app_private.jobs(workspace_id,kind,dedup_key,payload,available_at) values(p_workspace,'reconcile_send',p_id::text,jsonb_build_object('operationId',p_id),now()+interval '90 seconds');
  return jsonb_build_object('kind','reserved','senderId',c.sender_id,'providerConversationId',c.provider_conversation_id,'body',btrim(p_body));
end;
$$;
revoke all on function public.reserve_send(uuid,uuid,uuid,text,uuid,integer,integer,integer) from public,anon;
grant execute on function public.reserve_send(uuid,uuid,uuid,text,uuid,integer,integer,integer) to authenticated;
