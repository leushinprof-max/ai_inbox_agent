-- Reply guidance is separate from product facts and the internal legacy description.
alter table public.agents
 add column custom_instructions text not null default '' check(length(custom_instructions)<=8000),
 add column meeting_instructions text not null default '' check(length(meeting_instructions)<=2000),
 add column resources jsonb not null default '[]' check(jsonb_typeof(resources)='array' and jsonb_array_length(resources)<=20);
alter table public.senders add column grammatical_form text not null default 'unspecified'
 check(grammatical_form in ('unspecified','feminine','masculine'));

create function app_private.valid_agent_resources(items jsonb,workspace uuid) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>20 then return false;end if;
 for item in select * from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object'
   or coalesce(item->>'kind','') not in ('link','pdf')
   or coalesce(item->>'id','') !~ '^[a-f0-9-]{36}$'
   or length(btrim(coalesce(item->>'name',''))) not between 1 and 200
   or length(btrim(coalesce(item->>'whenToUse',''))) not between 1 and 2000
   or length(coalesce(item->>'url',''))>2000
   or coalesce(item->>'url','') !~ '^https?://[^[:space:]]+$'
   then return false; end if;
  if item->>'kind'='pdf' and (
   coalesce(item->>'storagePath','') !~ ('^'||workspace::text||'/[a-f0-9-]{36}/presentation[.]pdf$')
   or length(coalesce(item->>'fileName','')) not between 1 and 200
  ) then return false;end if;
 end loop;
 return true;
end;
$$;
revoke all on function app_private.valid_agent_resources(jsonb,uuid) from public,anon,authenticated;

-- Enrich every snapshot, including those created by Save to Knowledge and older clients.
create function app_private.enrich_agent_guidance() returns trigger
language plpgsql set search_path='' as $$
begin
 select new.configuration || jsonb_build_object(
  'customInstructions',a.custom_instructions,'meetingInstructions',a.meeting_instructions,'resources',a.resources)
 into new.configuration from public.agents a where a.workspace_id=new.workspace_id and a.id=new.agent_id;
 return new;
end;
$$;
revoke all on function app_private.enrich_agent_guidance() from public,anon,authenticated;
create trigger agent_guidance_snapshot before insert on public.agent_versions
 for each row execute function app_private.enrich_agent_guidance();

create or replace function public.save_agent(p_workspace uuid,p_id uuid,p_revision integer,p_config jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare current_row public.agents; new_version integer;
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_config) <> 'object' or length(coalesce(p_config->>'goal','')) > 8000 or length(coalesce(p_config->>'language','')) > 80 then raise exception 'Invalid agent' using errcode='22023'; end if;
  if not app_private.valid_agent_resources(coalesce(p_config->'resources','[]'::jsonb),p_workspace) then raise exception 'Invalid resources' using errcode='22023'; end if;
  -- Lock the workspace for first-insert races as well as existing agent updates.
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into current_row from public.agents where workspace_id=p_workspace and id=p_id for update;
  if found then
    if current_row.version <> p_revision then raise exception 'Agent changed; reload before saving' using errcode='PT409'; end if;
    update public.agents set name=p_config->>'name', description=coalesce(p_config->>'description',''), goal=coalesce(p_config->>'goal',''),
      language=coalesce(p_config->>'language','English'), reply_groups=array(select jsonb_array_elements_text(coalesce(p_config->'replyGroups','["positive"]'::jsonb))), knowledge=coalesce(p_config->>'knowledge',''), status=p_config->>'status', custom_instructions=coalesce(p_config->>'customInstructions',current_row.custom_instructions), meeting_instructions=coalesce(p_config->>'meetingInstructions',current_row.meeting_instructions), resources=coalesce(p_config->'resources',current_row.resources)
      where workspace_id=p_workspace and id=p_id returning version into new_version;
  else
    if p_revision <> 0 then raise exception 'Agent changed or not found' using errcode='PT409'; end if;
    insert into public.agents(id,workspace_id,name,description,goal,language,reply_groups,knowledge,status,custom_instructions,meeting_instructions,resources)
      values(p_id,p_workspace,p_config->>'name',coalesce(p_config->>'description',''),coalesce(p_config->>'goal',''),coalesce(p_config->>'language','English'),array(select jsonb_array_elements_text(coalesce(p_config->'replyGroups','["positive"]'::jsonb))),coalesce(p_config->>'knowledge',''),p_config->>'status',coalesce(p_config->>'customInstructions',''),coalesce(p_config->>'meetingInstructions',''),coalesce(p_config->'resources','[]'::jsonb)) returning version into new_version;
  end if;
  if p_config->>'status' = 'active' then
    insert into public.agent_versions(workspace_id,agent_id,version,configuration)
      select workspace_id,id,version,jsonb_build_object('name',name,'goal',goal,'language',language,'replyGroups',to_jsonb(reply_groups),'knowledge',knowledge)
      from public.agents where workspace_id=p_workspace and id=p_id;
  end if;
  return new_version;
end;
$$;

create function public.save_sender_voice(p_workspace uuid,p_sender bigint,p_form text,p_expected text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.senders; a public.agents; target_agent uuid;
begin
 if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_form is null or p_form not in ('unspecified','feminine','masculine') then raise exception 'Invalid form' using errcode='22023';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into s from public.senders where workspace_id=p_workspace and provider_id=p_sender for update;
 if not found then raise exception 'Sender not found' using errcode='22023';end if;
 if s.grammatical_form is distinct from p_expected then raise exception 'Sender changed; reload before saving' using errcode='PT409';end if;
 if s.grammatical_form=p_form then return;end if;
 update public.senders set grammatical_form=p_form where workspace_id=p_workspace and provider_id=p_sender;
 select coalesce(s.agent_id,w.default_agent_id) into target_agent from public.workspaces w where w.id=p_workspace;
 -- Invalidate in-flight generations that used the previous form.
 update public.agents set version=version where workspace_id=p_workspace and id=target_agent returning * into a;
 if a.id is not null and a.status='active' then
  insert into public.agent_versions(workspace_id,agent_id,version,configuration) values(p_workspace,a.id,a.version,
   jsonb_build_object('name',a.name,'goal',a.goal,'language',a.language,'replyGroups',to_jsonb(a.reply_groups),'knowledge',a.knowledge));
 end if;
end;
$$;
revoke all on function public.save_sender_voice(uuid,bigint,text,text) from public,anon;
grant execute on function public.save_sender_voice(uuid,bigint,text,text) to authenticated;

-- Only authenticated workspace admins receive scoped, non-overwriting upload tokens.
-- No direct client writes or bucket listing. Files are intentionally shareable by URL.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('agent-resources','agent-resources',true,20971520,array['application/pdf'])
 on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.server_connect(p_workspace uuid,p_actor uuid,p_ciphertext text,p_fingerprint text,p_webhook_hash text,p_senders jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin')) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  if exists(select 1 from public.send_operations where workspace_id=p_workspace and status='sending') then raise exception 'A send is in progress' using errcode='PT409'; end if;
  insert into app_private.provider_credentials(workspace_id,ciphertext,key_fingerprint,webhook_hash) values(p_workspace,p_ciphertext,p_fingerprint,p_webhook_hash)
    on conflict(workspace_id) do update set ciphertext=excluded.ciphertext,key_fingerprint=excluded.key_fingerprint,webhook_hash=excluded.webhook_hash,updated_at=now();
  -- Preserve local sender settings and assignments across refreshes and reconnections.
  update public.senders set auth_valid=false where workspace_id=p_workspace;

  insert into public.senders(workspace_id,provider_id,name,auth_valid)
    select p_workspace,(s->>'id')::bigint,s->>'name',(s->>'authValid')::boolean from jsonb_array_elements(p_senders) s
    on conflict(workspace_id,provider_id) do update set name=excluded.name,auth_valid=excluded.auth_valid;
  update public.connections set status='connected',webhook_status='waiting',last_event_at=null,revision=revision+1 where workspace_id=p_workspace;
end;
$$;
revoke all on function public.server_connect(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_connect(uuid,uuid,text,text,text,jsonb) to service_role;


create or replace function public.server_refresh_senders(p_workspace uuid,p_revision integer,p_senders jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_revision) then raise exception 'Connection changed' using errcode='PT409'; end if;
  if jsonb_typeof(p_senders)<>'array' or jsonb_array_length(p_senders)>1000 then raise exception 'Invalid sender list' using errcode='22023'; end if;
  -- Preserve local sender settings and assignments across refreshes and reconnections.
  update public.senders set auth_valid=false where workspace_id=p_workspace;

  insert into public.senders(workspace_id,provider_id,name,auth_valid)
    select p_workspace,(s->>'id')::bigint,s->>'name',(s->>'authValid')::boolean from jsonb_array_elements(p_senders) s
    on conflict(workspace_id,provider_id) do update set name=excluded.name,auth_valid=excluded.auth_valid;
end;
$$;
revoke all on function public.server_refresh_senders(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.server_refresh_senders(uuid,integer,jsonb) to service_role;

