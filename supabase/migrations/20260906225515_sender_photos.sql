ALTER TABLE public.conversations ADD COLUMN sender_photo_url text;

create or replace function public.server_ingest_conversation(p_workspace uuid,p_connection_revision integer,p_data jsonb,p_run uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations; m jsonb; inserted integer:=0; incoming integer:=0; changed integer; op public.send_operations; msg_id uuid; matches integer;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_connection_revision) then raise exception 'Connection changed' using errcode='PT409'; end if;
  if not exists(select 1 from public.senders where workspace_id=p_workspace and provider_id=(p_data->>'senderId')::bigint) then raise exception 'Sender is outside this workspace connection' using errcode='42501'; end if;
  if p_run is not null and not exists(select 1 from public.import_runs where id=p_run and workspace_id=p_workspace and status in ('queued','running')) then return null; end if;
  insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,contact_company,contact_position,contact_photo_url,sender_photo_url)
    values(p_workspace,p_data->>'id',(p_data->>'senderId')::bigint,p_data->>'senderName',p_data->>'contactName',coalesce(p_data->>'company',''),coalesce(p_data->>'position',''),nullif(p_data->>'photoUrl',''),nullif(p_data->>'senderPhotoUrl',''))
    on conflict(workspace_id,sender_id,provider_conversation_id) do update set sender_name=excluded.sender_name,contact_name=excluded.contact_name,contact_company=excluded.contact_company,contact_position=excluded.contact_position,contact_photo_url=coalesce(excluded.contact_photo_url,public.conversations.contact_photo_url),sender_photo_url=coalesce(excluded.sender_photo_url,public.conversations.sender_photo_url) returning * into c;
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
