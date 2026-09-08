-- Existing and subsequently imported history starts read. Live unique replies reopen it.
alter table public.conversations add column unread boolean not null default false,
  add column read_state_revision integer not null default 0 check(read_state_revision>=0);
create index conversations_unread_recent_idx on public.conversations(workspace_id,last_message_at desc,id desc) where unread and not archived and inbound_revision>0;

create function public.set_conversation_read_state(p_workspace uuid,p_id uuid,p_revision integer,p_unread boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_revision is null or p_revision<0 or p_unread is null then raise exception 'Invalid read state' using errcode='22023'; end if;
  update public.conversations set unread=p_unread,read_state_revision=read_state_revision+1
  where workspace_id=p_workspace and id=p_id and read_state_revision=p_revision;
  if not found then raise exception 'Read state changed. Refresh and try again.' using errcode='PT409'; end if;
end;
$$;
revoke all on function public.set_conversation_read_state(uuid,uuid,integer,boolean) from public,anon;
grant execute on function public.set_conversation_read_state(uuid,uuid,integer,boolean) to authenticated;

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
  update public.conversations set unread=case when incoming>0 and p_run is null then true else unread end,read_state_revision=read_state_revision+case when incoming>0 and p_run is null then 1 else 0 end,inbound_revision=inbound_revision+incoming,last_message_at=(select max(occurred_at) from public.messages where workspace_id=p_workspace and conversation_id=c.id) where workspace_id=p_workspace and id=c.id returning * into c;
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

create or replace function public.conversation_page_v2(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_read text default 'all')
returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c where c.workspace_id=p_workspace and not c.archived and c.inbound_revision>0 and (p_read='all' or (p_read='unread' and c.unread) or (p_read='read' and not c.unread))
    and (p_query='' or c.contact_name ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or c.contact_company ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or (select m.body from public.messages m where m.workspace_id=c.workspace_id and m.conversation_id=c.id order by m.occurred_at desc,m.id desc limit 1) ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%')
    and (p_label is null or p_label=c.label_id::text or (p_label='uncategorized' and c.label_state='uncategorized' and c.classified_revision=c.inbound_revision) or exists(select 1 from public.workspace_labels l where l.workspace_id=c.workspace_id and l.id=c.label_id and 'group:'||l.intent_group=p_label))
    and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
  order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.conversation_page_v2(uuid,text,text,timestamptz,uuid,integer,text) from public,anon;
grant execute on function public.conversation_page_v2(uuid,text,text,timestamptz,uuid,integer,text) to authenticated;

create function public.conversation_counts(p_workspace uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
select jsonb_build_object('all',count(*),'unread',count(*) filter(where c.unread),
  'interested',count(*) filter(where l.system_key='interested'),
  'meeting_request',count(*) filter(where l.system_key='meeting_request'),
  'information_request',count(*) filter(where l.system_key='information_request'))
from public.conversations c left join public.workspace_labels l on l.workspace_id=c.workspace_id and l.id=c.label_id
where c.workspace_id=p_workspace and not c.archived and c.inbound_revision>0;
$$;
revoke all on function public.conversation_counts(uuid) from public,anon;
grant execute on function public.conversation_counts(uuid) to authenticated;
