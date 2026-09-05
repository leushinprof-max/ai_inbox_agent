alter table app_private.jobs add column rerun_requested boolean not null default false;
create or replace function public.server_enqueue(p_workspace uuid,p_kind text,p_key text,p_payload jsonb) returns void
language sql security definer set search_path='' as $$
 insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,p_kind,p_key,p_payload)
 on conflict(workspace_id,kind,dedup_key) do update set
   payload=excluded.payload,
   status=case when jobs.status='running' then 'running' else 'queued' end,
   rerun_requested=jobs.status='running',
   attempts=case when jobs.status in ('done','failed') then 0 else jobs.attempts end,
   error_code=null,available_at=now()
 where jobs.kind='sync';
$$;

create or replace function public.server_finish_job(p_id uuid,p_lease uuid,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j app_private.jobs;
begin
  update app_private.jobs set status=case when rerun_requested then 'queued' when p_error is null then 'done'
    when attempts>=5 or p_error in ('model_not_configured','connection_changed','connection_unavailable','provider_unauthorized','sender_not_in_workspace') then 'failed' else 'queued' end,
    error_code=case when rerun_requested then null else left(p_error,100) end,
    available_at=case when rerun_requested then now() else now()+interval '30 seconds'*greatest(attempts,1) end,
    attempts=case when rerun_requested then 0 else attempts end,rerun_requested=false,lease_until=null
    where id=p_id and lease_token=p_lease and status='running' returning * into j;
  if not found then raise exception 'Lease changed' using errcode='PT409'; end if;
  if j.status='failed' and j.payload->>'runId' is not null then
    update public.import_runs set status='failed',error_code=j.error_code,updated_at=now()
      where workspace_id=j.workspace_id and id::text=j.payload->>'runId' and status in ('queued','running');
  end if;
end;
$$;

create or replace function public.server_connect(p_workspace uuid,p_actor uuid,p_ciphertext text,p_fingerprint text,p_webhook_hash text,p_senders jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin')) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  if exists(select 1 from public.send_operations where workspace_id=p_workspace and status in ('sending','unknown')) then raise exception 'Resolve the previous send before changing the connection' using errcode='PT409'; end if;
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
