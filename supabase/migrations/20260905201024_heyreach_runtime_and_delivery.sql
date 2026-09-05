-- Runtime data is separated from browser-visible connection status.
alter table public.connections add column revision integer not null default 0;
create table app_private.provider_credentials (
  workspace_id uuid primary key references public.workspaces(id),
  ciphertext text not null,
  key_fingerprint text not null unique,
  webhook_hash text not null unique,
  updated_at timestamptz not null default now()
);
alter table app_private.provider_credentials enable row level security;
revoke all on app_private.provider_credentials from public,anon,authenticated;
grant usage on schema app_private to service_role;
grant select,insert,update,delete on app_private.provider_credentials to service_role;

create table public.senders (
  workspace_id uuid not null references public.workspaces(id),
  provider_id bigint not null check(provider_id>0),
  name text not null,
  auth_valid boolean not null,
  updated_at timestamptz not null default now(),
  primary key(workspace_id,provider_id)
);
alter table public.senders enable row level security;
revoke all on public.senders from public,anon,authenticated;
grant select on public.senders to authenticated;
grant select,insert,update,delete on public.senders to service_role;
create policy sender_read on public.senders for select to authenticated using(app_private.has_role(workspace_id));

create table public.send_operations (
  workspace_id uuid not null,
  id uuid not null,
  user_id uuid not null references auth.users(id),
  conversation_id uuid not null,
  request jsonb not null,
  source_revision integer not null,
  status text not null check(status in ('sending','sent','rejected','unknown')),
  reason text,
  message_id uuid references public.messages(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,id),
  foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id)
);
create unique index one_unresolved_send on public.send_operations(workspace_id,conversation_id) where status in ('sending','unknown');
alter table public.send_operations enable row level security;
revoke all on public.send_operations from public,anon,authenticated;
grant select on public.send_operations to authenticated;
grant select,insert,update on public.send_operations to service_role;
create policy send_read on public.send_operations for select to authenticated using(app_private.has_role(workspace_id));

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  days integer not null check(days in (7,14,30,90)),
  window_start timestamptz not null,
  window_end timestamptz not null default now(),
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  provider_offset integer not null default 0,
  inspected integer not null default 0,
  imported integer not null default 0,
  classified integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,id)
);
create unique index one_active_import on public.import_runs(workspace_id) where status in ('queued','running');
alter table public.import_runs enable row level security;
revoke all on public.import_runs from public,anon,authenticated;
grant select on public.import_runs to authenticated;
grant select,insert,update on public.import_runs to service_role;
create policy import_read on public.import_runs for select to authenticated using(app_private.has_role(workspace_id));

create table app_private.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  kind text not null check(kind in ('sync','import','classify','reconcile_send')),
  dedup_key text not null,
  payload jsonb not null,
  status text not null default 'queued' check(status in ('queued','running','done','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique(workspace_id,kind,dedup_key)
);
create index job_claim_idx on app_private.jobs(available_at,created_at) where status in ('queued','running');
alter table app_private.jobs enable row level security;
revoke all on app_private.jobs from public,anon,authenticated;
grant select,insert,update on app_private.jobs to service_role;

create function public.server_credentials(p_workspace uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ciphertext',ciphertext,'webhookHash',webhook_hash) from app_private.provider_credentials where workspace_id=p_workspace;
$$;
revoke all on function public.server_credentials(uuid) from public,anon,authenticated;
grant execute on function public.server_credentials(uuid) to service_role;

create function public.server_connect(p_workspace uuid,p_actor uuid,p_ciphertext text,p_fingerprint text,p_webhook_hash text,p_senders jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin')) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  if exists(select 1 from public.send_operations where workspace_id=p_workspace and status='sending') then raise exception 'A send is in progress' using errcode='PT409'; end if;
  insert into app_private.provider_credentials(workspace_id,ciphertext,key_fingerprint,webhook_hash) values(p_workspace,p_ciphertext,p_fingerprint,p_webhook_hash)
    on conflict(workspace_id) do update set ciphertext=excluded.ciphertext,key_fingerprint=excluded.key_fingerprint,webhook_hash=excluded.webhook_hash,updated_at=now();
  delete from public.senders where workspace_id=p_workspace;
  insert into public.senders(workspace_id,provider_id,name,auth_valid)
    select p_workspace,(s->>'id')::bigint,s->>'name',(s->>'authValid')::boolean from jsonb_array_elements(p_senders) s;
  update public.connections set status='connected',webhook_status='waiting',last_event_at=null,revision=revision+1 where workspace_id=p_workspace;
end;
$$;
revoke all on function public.server_connect(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_connect(uuid,uuid,text,text,text,jsonb) to service_role;

create function public.disconnect_workspace(p_workspace uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  update public.connections set status='disconnected',webhook_status='not_configured',revision=revision+1 where workspace_id=p_workspace;
  delete from app_private.provider_credentials where workspace_id=p_workspace;
end;
$$;
revoke all on function public.disconnect_workspace(uuid) from public,anon;
grant execute on function public.disconnect_workspace(uuid) to authenticated;

create function public.reserve_send(p_workspace uuid,p_id uuid,p_conversation uuid,p_body text,p_draft uuid default null,p_revision integer default null,p_source_revision integer default null)
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
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected') or not exists(select 1 from public.senders where workspace_id=p_workspace and provider_id=c.sender_id and auth_valid) then raise exception 'Connect the conversation sender' using errcode='22023'; end if;
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
revoke all on function public.reserve_send(uuid,uuid,uuid,text,uuid,integer,integer) from public,anon;
grant execute on function public.reserve_send(uuid,uuid,uuid,text,uuid,integer,integer) to authenticated;

create function public.server_complete_send(p_workspace uuid,p_id uuid,p_status text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare op public.send_operations; new_message uuid;
begin
  if p_status not in ('sent','unknown','rejected') or p_status is null then raise exception 'Invalid outcome' using errcode='22023'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into op from public.send_operations where workspace_id=p_workspace and id=p_id for update;
  if not found then raise exception 'Unknown operation' using errcode='22023'; end if;
  if op.status in ('sent','rejected') then return; end if;
  if p_status='sent' then
    insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
      values(p_workspace,op.conversation_id,'send:'||p_id::text,op.request->>'body','outbound','accepted_send',op.created_at)
      on conflict(workspace_id,conversation_id,ingestion_key) do update set body=excluded.body returning id into new_message;
    update public.drafts set status='sent',revision=revision+1 where workspace_id=p_workspace and conversation_id=op.conversation_id and status in ('ready','needs_input','snoozed') and source_revision <= op.source_revision;
    update public.conversations set last_message_at=greatest(last_message_at,op.created_at) where workspace_id=p_workspace and id=op.conversation_id;
  end if;
  update public.send_operations set status=p_status,reason=left(p_reason,200),message_id=new_message,updated_at=now() where workspace_id=p_workspace and id=p_id;
end;
$$;
revoke all on function public.server_complete_send(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.server_complete_send(uuid,uuid,text,text) to service_role;

create function public.server_enqueue(p_workspace uuid,p_kind text,p_key text,p_payload jsonb) returns void
language sql security definer set search_path='' as $$
 insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,p_kind,p_key,p_payload) on conflict(workspace_id,kind,dedup_key) do nothing;
$$;
revoke all on function public.server_enqueue(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_enqueue(uuid,text,text,jsonb) to service_role;

create function public.server_claim_job() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j app_private.jobs;
begin
  update app_private.jobs set status='failed',error_code='attempts_exhausted' where status='running' and lease_until<now() and attempts>=5;
  select * into j from app_private.jobs where (status='queued' and available_at<=now() or status='running' and lease_until<now()) and attempts<5 order by available_at,created_at for update skip locked limit 1;
  if not found then return null; end if;
  update app_private.jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=j.id returning * into j;
  return to_jsonb(j);
end;
$$;
revoke all on function public.server_claim_job() from public,anon,authenticated;
grant execute on function public.server_claim_job() to service_role;

create function public.server_finish_job(p_id uuid,p_lease uuid,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  update app_private.jobs set status=case when p_error is null then 'done' when attempts>=5 then 'failed' else 'queued' end,error_code=p_error,available_at=now()+interval '30 seconds'*greatest(attempts,1),lease_until=null
    where id=p_id and lease_token=p_lease and status='running';
  if not found then raise exception 'Lease changed' using errcode='PT409'; end if;
end;
$$;
revoke all on function public.server_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.server_finish_job(uuid,uuid,text) to service_role;

create function public.start_history_import(p_workspace uuid,p_days integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare run_id uuid;
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_days not in (7,14,30,90) or p_days is null then raise exception 'Invalid history window' using errcode='22023'; end if;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected') then raise exception 'Connect HeyReach first' using errcode='22023'; end if;
  insert into public.import_runs(workspace_id,days,window_start) values(p_workspace,p_days,now()-make_interval(days=>p_days)) returning id into run_id;
  insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'import',run_id::text||':0',jsonb_build_object('runId',run_id,'offset',0));
  return run_id;
end;
$$;
revoke all on function public.start_history_import(uuid,integer) from public,anon;
grant execute on function public.start_history_import(uuid,integer) to authenticated;

-- The old foundation mutation is superseded by act_on_draft; no browser may use its generic rollback error code.
revoke execute on function public.update_draft(uuid,uuid,integer,text,text,timestamptz) from authenticated;
