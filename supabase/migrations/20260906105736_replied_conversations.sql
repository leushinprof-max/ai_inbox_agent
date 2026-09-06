-- Conversations enter the operator inbox only after a canonical lead reply.
-- Retain pre-reply history so the first reply reveals its full context.
alter table app_private.import_items add column skipped boolean not null default false;

create or replace function app_private.update_import_progress(p_run uuid) returns void
language plpgsql set search_path='' as $$
begin
  update public.import_runs r set
    imported=(select count(*) from app_private.import_items where run_id=p_run and ingested and not skipped),
    classified=(select count(*) from app_private.import_items where run_id=p_run and classified and not skipped),
    updated_at=now(),
    status=case when r.scan_finished and not exists(
      select 1 from app_private.import_items where run_id=p_run and not (classified or skipped)
    ) then 'completed' else r.status end
    where r.id=p_run and r.status in ('queued','running');
end;
$$;

create or replace function public.conversation_page(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c where c.workspace_id=p_workspace and not c.archived and c.inbound_revision>0
    and (p_query='' or c.contact_name ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or c.contact_company ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%')
    and (p_label is null or p_label=any(c.labels))
    and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
  order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit least(greatest(p_limit,1),100);
$$;

create or replace function public.server_ingest_conversation(p_workspace uuid,p_connection_revision integer,p_data jsonb,p_run uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations; m jsonb; inserted integer:=0; incoming integer:=0; changed integer; op public.send_operations; msg_id uuid; matches integer;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_connection_revision) then raise exception 'Connection changed' using errcode='PT409'; end if;
  if not exists(select 1 from public.senders where workspace_id=p_workspace and provider_id=(p_data->>'senderId')::bigint) then raise exception 'Sender is outside this workspace connection' using errcode='42501'; end if;
  if p_run is not null and not exists(select 1 from public.import_runs where id=p_run and workspace_id=p_workspace and status in ('queued','running')) then return null; end if;
  insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,contact_company,contact_position)
    values(p_workspace,p_data->>'id',(p_data->>'senderId')::bigint,p_data->>'senderName',p_data->>'contactName',coalesce(p_data->>'company',''),coalesce(p_data->>'position',''))
    on conflict(workspace_id,sender_id,provider_conversation_id) do update set sender_name=excluded.sender_name,contact_name=excluded.contact_name,contact_company=excluded.contact_company,contact_position=excluded.contact_position returning * into c;
  if jsonb_array_length(p_data->'messages')>5000 then raise exception 'Conversation exceeds message budget' using errcode='22023'; end if;
  for m in select value from jsonb_array_elements(p_data->'messages') loop
    if exists(select 1 from public.messages where workspace_id=p_workspace and conversation_id=c.id and ingestion_key=m->>'key') then continue; end if;
    msg_id=null;
    if m->>'direction'='outbound' then
      select count(*) into matches from public.send_operations o left join public.messages pm on pm.id=o.message_id
        where o.workspace_id=p_workspace and o.conversation_id=c.id and o.status in ('sending','unknown','sent') and o.request->>'body'=m->>'body'
        and o.created_at between (m->>'occurredAt')::timestamptz-interval '5 minutes' and (m->>'occurredAt')::timestamptz+interval '5 seconds'
        and (o.message_id is null or pm.source='accepted_send');
      if matches=1 then
        select o.* into op from public.send_operations o left join public.messages pm on pm.id=o.message_id
          where o.workspace_id=p_workspace and o.conversation_id=c.id and o.status in ('sending','unknown','sent') and o.request->>'body'=m->>'body'
          and o.created_at between (m->>'occurredAt')::timestamptz-interval '5 minutes' and (m->>'occurredAt')::timestamptz+interval '5 seconds'
          and (o.message_id is null or pm.source='accepted_send') for update of o;
        if op.message_id is not null then
          update public.messages set ingestion_key=m->>'key',source='provider',occurred_at=(m->>'occurredAt')::timestamptz where id=op.message_id and workspace_id=p_workspace returning id into msg_id;
        end if;
      end if;
    else matches=0;
    end if;
    if msg_id is null then
      insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
        values(p_workspace,c.id,m->>'key',m->>'body',m->>'direction','provider',(m->>'occurredAt')::timestamptz)
        on conflict(workspace_id,conversation_id,ingestion_key) do nothing returning id into msg_id;
      get diagnostics changed=row_count;inserted=inserted+changed;
      if changed>0 and m->>'direction'='inbound' then incoming=incoming+1; end if;
    end if;
    if matches=1 and msg_id is not null then
      update public.send_operations set status='sent',reason=null,message_id=msg_id,updated_at=now() where workspace_id=p_workspace and id=op.id;
      update public.drafts set status='sent',revision=revision+1 where workspace_id=p_workspace and conversation_id=c.id and status in ('ready','needs_input','snoozed') and source_revision<=op.source_revision;
    end if;
  end loop;
  update public.conversations set inbound_revision=inbound_revision+incoming,last_message_at=(select max(occurred_at) from public.messages where workspace_id=p_workspace and conversation_id=c.id) where workspace_id=p_workspace and id=c.id returning * into c;
  if p_run is not null then
    update app_private.import_items set ingested=true,skipped=c.inbound_revision=0,conversation_id=c.id where run_id=p_run and workspace_id=p_workspace and provider_key=c.sender_id||':'||c.provider_conversation_id;
    perform app_private.update_import_progress(p_run);
  end if;
  if c.inbound_revision>0 and (incoming>0 or p_run is not null) then
    insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'classify',coalesce(p_run::text,'live')||':'||c.id||':'||c.inbound_revision,
      jsonb_build_object('conversationId',c.id,'revision',c.inbound_revision,'runId',p_run,'generateDraft',p_run is null)) on conflict do nothing;
  end if;
  return jsonb_build_object('conversationId',c.id,'revision',c.inbound_revision,'inserted',inserted);
end;
$$;

create or replace function public.server_apply_classification(p_workspace uuid,p_conversation uuid,p_revision integer,p_labels text[],p_agent uuid,p_agent_version integer,p_draft text,p_missing text,p_generate boolean,p_run uuid default null,p_connection_revision integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.conversations; current_agent uuid; answered boolean;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_connection_revision) then raise exception 'Connection changed' using errcode='PT409'; end if;
  if p_run is not null and not exists(select 1 from public.import_runs where workspace_id=p_workspace and id=p_run and status in ('queued','running')) then return false; end if;
  select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation for update;
  if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  -- Also reject results from an old worker that classified outreach before this migration.
  if c.inbound_revision=0 then
    if p_run is not null then
      update app_private.import_items set skipped=true,classified=false
        where workspace_id=p_workspace and run_id=p_run and conversation_id=c.id;
      perform app_private.update_import_progress(p_run);
    end if;
    return false;
  end if;
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

-- Repair derived labels and import totals without deleting conversations/messages.
update public.conversations set labels='{}',classified_revision=null
  where inbound_revision=0 and (cardinality(labels)>0 or classified_revision is not null);
update app_private.import_items i set skipped=true,classified=false
  from public.conversations c
  where c.workspace_id=i.workspace_id and c.id=i.conversation_id and c.inbound_revision=0;
update public.import_runs r set
  imported=(select count(*) from app_private.import_items i where i.run_id=r.id and i.ingested and not i.skipped),
  classified=(select count(*) from app_private.import_items i where i.run_id=r.id and i.classified and not i.skipped)
  where exists(select 1 from app_private.import_items i where i.run_id=r.id and i.skipped);
select app_private.update_import_progress(id) from public.import_runs where status in ('queued','running');
