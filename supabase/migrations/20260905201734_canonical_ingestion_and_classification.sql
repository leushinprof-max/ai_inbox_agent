alter table public.workspaces add column default_agent_id uuid;
alter table public.workspaces add constraint workspace_default_agent_fk foreign key(id,default_agent_id) references public.agents(workspace_id,id);
alter table public.conversations add column classified_revision integer;
alter table public.import_runs add column scan_finished boolean not null default false;
create table app_private.import_items (
  workspace_id uuid not null,
  run_id uuid not null,
  provider_key text not null,
  conversation_id uuid,
  ingested boolean not null default false,
  classified boolean not null default false,
  primary key(run_id,provider_key),
  foreign key(workspace_id,run_id) references public.import_runs(workspace_id,id),
  foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id)
);
alter table app_private.import_items enable row level security;
revoke all on app_private.import_items from public,anon,authenticated;
grant select,insert,update on app_private.import_items to service_role;

create function public.set_default_agent(p_workspace uuid,p_agent uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.agents where workspace_id=p_workspace and id=p_agent and status='active') then raise exception 'Activate the agent first' using errcode='22023'; end if;
  update public.workspaces set default_agent_id=p_agent where id=p_workspace;
end;
$$;
revoke all on function public.set_default_agent(uuid,uuid) from public,anon;
grant execute on function public.set_default_agent(uuid,uuid) to authenticated;

create function app_private.update_import_progress(p_run uuid) returns void
language plpgsql set search_path='' as $$
begin
  update public.import_runs r set imported=(select count(*) from app_private.import_items where run_id=p_run and ingested),classified=(select count(*) from app_private.import_items where run_id=p_run and classified),updated_at=now(),
    status=case when r.scan_finished and not exists(select 1 from app_private.import_items where run_id=p_run and not classified) then 'completed' else r.status end
    where r.id=p_run and r.status in ('queued','running');
end;
$$;
revoke all on function app_private.update_import_progress(uuid) from public,anon,authenticated;

create function public.server_import_page(p_run uuid,p_offset integer,p_received integer,p_total integer,p_items jsonb,p_connection_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare r public.import_runs; item jsonb; item_key text; next_offset integer;
begin
  select * into r from public.import_runs where id=p_run for update;
  if not found or r.status not in ('queued','running') or r.provider_offset<>p_offset then return; end if;
  if p_received<0 or p_received>100 or jsonb_array_length(p_items)>100 or p_total<0 then raise exception 'Invalid page' using errcode='22023'; end if;
  if p_received=0 and p_offset<p_total then raise exception 'Incomplete provider page' using errcode='22023'; end if;
  foreach item in array array(select value from jsonb_array_elements(p_items)) loop
    item_key=(item->>'senderId')||':'||(item->>'id');
    insert into app_private.import_items(workspace_id,run_id,provider_key) values(r.workspace_id,r.id,item_key) on conflict do nothing;
    insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(r.workspace_id,'sync','import:'||r.id||':'||item_key,jsonb_build_object('runId',r.id,'conversationId',item->>'id','senderId',(item->>'senderId')::bigint,'connectionRevision',p_connection_revision)) on conflict do nothing;
  end loop;
  next_offset=p_offset+p_received;
  update public.import_runs set provider_offset=next_offset,inspected=inspected+p_received,status='running',scan_finished=next_offset>=p_total,updated_at=now() where id=r.id;
  if next_offset<p_total then
    if next_offset>=10000 then
      update public.import_runs set status='failed',error_code='scan_limit' where id=r.id;
    else
      insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(r.workspace_id,'import',r.id::text||':'||next_offset,jsonb_build_object('runId',r.id,'offset',next_offset)) on conflict do nothing;
    end if;
  end if;
  perform app_private.update_import_progress(r.id);
end;
$$;
revoke all on function public.server_import_page(uuid,integer,integer,integer,jsonb,integer) from public,anon,authenticated;
grant execute on function public.server_import_page(uuid,integer,integer,integer,jsonb,integer) to service_role;

create function public.server_ingest_conversation(p_workspace uuid,p_connection_revision integer,p_data jsonb,p_run uuid default null)
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
    update app_private.import_items set ingested=true,conversation_id=c.id where run_id=p_run and workspace_id=p_workspace and provider_key=c.sender_id||':'||c.provider_conversation_id;
    perform app_private.update_import_progress(p_run);
  end if;
  if incoming>0 or p_run is not null then
    insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'classify',coalesce(p_run::text,'live')||':'||c.id||':'||c.inbound_revision,
      jsonb_build_object('conversationId',c.id,'revision',c.inbound_revision,'runId',p_run,'generateDraft',p_run is null)) on conflict do nothing;
  end if;
  return jsonb_build_object('conversationId',c.id,'revision',c.inbound_revision,'inserted',inserted);
end;
$$;
revoke all on function public.server_ingest_conversation(uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.server_ingest_conversation(uuid,integer,jsonb,uuid) to service_role;

create function public.server_apply_classification(p_workspace uuid,p_conversation uuid,p_revision integer,p_labels text[],p_agent uuid,p_agent_version integer,p_draft text,p_missing text,p_generate boolean,p_run uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.conversations; current_agent uuid; answered boolean;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
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
revoke all on function public.server_apply_classification(uuid,uuid,integer,text[],uuid,integer,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.server_apply_classification(uuid,uuid,integer,text[],uuid,integer,text,text,boolean,uuid) to service_role;

create function public.retry_history_import(p_workspace uuid,p_run uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  update public.import_runs set status='running',error_code=null,updated_at=now() where workspace_id=p_workspace and id=p_run and status='failed' and error_code is distinct from 'scan_limit';
  if not found then raise exception 'Import cannot be retried' using errcode='PT409'; end if;
  update app_private.jobs set status='queued',attempts=0,error_code=null,available_at=now(),lease_until=null where workspace_id=p_workspace and payload->>'runId'=p_run::text and status='failed';
end;
$$;
revoke all on function public.retry_history_import(uuid,uuid) from public,anon;
grant execute on function public.retry_history_import(uuid,uuid) to authenticated;
