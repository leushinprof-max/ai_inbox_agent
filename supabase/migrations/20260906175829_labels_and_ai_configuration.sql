-- Single intent labels and a platform-owned, versioned prompt registry.
create table app_private.platform_owners(user_id uuid primary key references auth.users(id));
revoke all on app_private.platform_owners from public,anon,authenticated;
insert into app_private.platform_owners select id from auth.users where id='a8fc2abe-b212-4f79-bc69-cd54249363ad' and email='leushin.prof@gmail.com';
create function public.is_platform_owner() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from app_private.platform_owners where user_id=auth.uid());
$$;
revoke all on function public.is_platform_owner() from public,anon;
grant execute on function public.is_platform_owner() to authenticated,service_role;

create table public.ai_config_versions(id bigint generated always as identity primary key,configuration jsonb not null,created_by uuid references auth.users(id),created_at timestamptz not null default now());
create table public.ai_config_release(singleton boolean primary key default true check(singleton),version_id bigint not null references public.ai_config_versions(id),revision integer not null default 1);
create table public.ai_config_publications(id bigint generated always as identity primary key,version_id bigint not null references public.ai_config_versions(id),actor uuid references auth.users(id),created_at timestamptz not null default now());
alter table public.ai_config_versions enable row level security;
alter table public.ai_config_release enable row level security;
alter table public.ai_config_publications enable row level security;
revoke all on public.ai_config_versions,public.ai_config_release,public.ai_config_publications from public,anon,authenticated;
grant select on public.ai_config_versions,public.ai_config_release,public.ai_config_publications to authenticated;
grant all on public.ai_config_versions,public.ai_config_release,public.ai_config_publications to service_role;
grant usage,select on sequence public.ai_config_versions_id_seq,public.ai_config_publications_id_seq to service_role;
create policy owner_read on public.ai_config_versions for select to authenticated using(public.is_platform_owner());
create policy release_read on public.ai_config_release for select to authenticated using(public.is_platform_owner());
create policy publication_read on public.ai_config_publications for select to authenticated using(public.is_platform_owner());
create function public.save_ai_configuration(p_configuration jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 if not public.is_platform_owner() then raise exception 'Forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_configuration)<>'object' or octet_length(p_configuration::text)>150000 or not(p_configuration ?& array['classification','replyDecision','draft','rewrite','needsInput','agentTemplate','labels','defaults']) then raise exception 'Invalid configuration' using errcode='22023'; end if;
 insert into public.ai_config_versions(configuration,created_by) values(p_configuration,auth.uid()) returning id into v;return v;
end;$$;
create function public.publish_ai_configuration(p_version bigint,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_owner() then raise exception 'Forbidden' using errcode='42501';end if;
 update public.ai_config_release set version_id=p_version,revision=revision+1 where singleton and revision=p_revision;
 if not found then raise exception 'Release changed' using errcode='PT409';end if;
 insert into public.ai_config_publications(version_id,actor) values(p_version,auth.uid());
end;$$;
revoke all on function public.save_ai_configuration(jsonb),public.publish_ai_configuration(bigint,integer) from public,anon;
grant execute on function public.save_ai_configuration(jsonb),public.publish_ai_configuration(bigint,integer) to authenticated;

alter table public.workspaces add column label_revision integer not null default 1;
create table public.workspace_labels(
 workspace_id uuid not null references public.workspaces(id),id uuid not null default gen_random_uuid(),
 system_key text,name text not null check(length(btrim(name)) between 1 and 80),
 intent_group text not null check(intent_group in ('positive','neutral','negative')),
 color text not null check(color in ('green','blue','purple','teal','amber','pink','red','gray')),
 instruction text not null default '' check(length(instruction)<=4000),enabled boolean not null default true,archived boolean not null default false,
 revision integer not null default 1,primary key(workspace_id,id),unique(workspace_id,system_key)
);
create unique index workspace_label_name on public.workspace_labels(workspace_id,lower(btrim(name)));
alter table public.workspace_labels enable row level security;
revoke all on public.workspace_labels from public,anon,authenticated;
grant select on public.workspace_labels to authenticated;
grant all on public.workspace_labels to service_role;
create policy label_read on public.workspace_labels for select to authenticated using(app_private.has_role(workspace_id));
create function app_private.seed_labels() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_labels(workspace_id,system_key,name,intent_group,color) values
 (new.id,'interested','Interested','positive','green'),(new.id,'information_request','Information Request','positive','blue'),
 (new.id,'meeting_request','Meeting Request','positive','purple'),(new.id,'referral','Referral','neutral','teal'),
 (new.id,'not_now','Not Now','neutral','amber'),(new.id,'wrong_person','Wrong Person','neutral','pink'),(new.id,'not_interested','Not interested','negative','red');
 return new;
end;$$;
revoke all on function app_private.seed_labels() from public,anon,authenticated;
create trigger seed_workspace_labels after insert on public.workspaces for each row execute function app_private.seed_labels();
insert into public.workspace_labels(workspace_id,system_key,name,intent_group,color)
 select w.id,l.* from public.workspaces w cross join (values
 ('interested','Interested','positive','green'),('information_request','Information Request','positive','blue'),('meeting_request','Meeting Request','positive','purple'),
 ('referral','Referral','neutral','teal'),('not_now','Not Now','neutral','amber'),('wrong_person','Wrong Person','neutral','pink'),('not_interested','Not interested','negative','red')) l(k,n,g,c);

alter table public.conversations add column label_id uuid,add column label_source text check(label_source in ('ai','manual','legacy')),
 add column label_assignment_revision integer not null default 0,add column label_state text not null default 'pending' check(label_state in ('pending','classified','uncategorized','failed','manual_clear')),
 add column evidence_message_id uuid,add column evidence_quote text not null default '',add column no_reply_reason text not null default '',
 add column reply_decision_revision integer,add column reply_agent_id uuid,add column reply_agent_version integer,add column reply_catalog_revision integer,add column reply_config_version bigint,
 add column contact_stopped boolean not null default false,
 add constraint conversation_label_fk foreign key(workspace_id,label_id) references public.workspace_labels(workspace_id,id);
create index conversation_label_idx on public.conversations(workspace_id,label_id,last_message_at desc,id desc) where inbound_revision>0 and not archived;
update public.conversations c set label_id=l.id,label_source='legacy',label_state='classified'
 from public.workspace_labels l where l.workspace_id=c.workspace_id and cardinality(c.labels)=1 and l.name=c.labels[1];

create function public.save_workspace_label(p_workspace uuid,p_id uuid,p_revision integer,p_value jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.workspace_labels;result uuid;
begin
 if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into l from public.workspace_labels where workspace_id=p_workspace and id=p_id for update;
 if found then
  if l.revision<>p_revision then raise exception 'Label changed' using errcode='PT409';end if;
  if l.system_key is not null then
   update public.workspace_labels set enabled=(p_value->>'enabled')::boolean,revision=revision+1 where workspace_id=p_workspace and id=p_id;
  else
   update public.workspace_labels set name=btrim(p_value->>'name'),intent_group=p_value->>'group',color=p_value->>'color',instruction=btrim(p_value->>'instruction'),enabled=(p_value->>'enabled')::boolean,archived=(p_value->>'archived')::boolean,revision=revision+1 where workspace_id=p_workspace and id=p_id;
  end if; result=p_id;
 else
  if p_revision<>0 then raise exception 'Label unavailable' using errcode='PT409';end if;
  if (select count(*) from public.workspace_labels where workspace_id=p_workspace)>=100 then raise exception 'Label limit reached' using errcode='22023';end if;
  insert into public.workspace_labels(workspace_id,id,name,intent_group,color,instruction) values(p_workspace,p_id,btrim(p_value->>'name'),p_value->>'group',p_value->>'color',btrim(p_value->>'instruction')) returning id into result;
 end if;
 if exists(select 1 from public.workspace_labels where workspace_id=p_workspace and id=result and system_key is null and nullif(btrim(instruction),'') is null) then raise exception 'Instruction required' using errcode='22023';end if;
 update public.workspaces set label_revision=label_revision+1 where id=p_workspace;return result;
end;$$;
create function public.assign_conversation_label(p_workspace uuid,p_conversation uuid,p_label uuid,p_revision integer,p_assignment integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if p_label is not null and not exists(select 1 from public.workspace_labels where workspace_id=p_workspace and id=p_label and enabled and not archived) then raise exception 'Label unavailable' using errcode='22023';end if;
 update public.conversations set label_id=p_label,label_source='manual',label_state=case when p_label is null then 'manual_clear' else 'classified' end,
 classified_revision=inbound_revision,label_assignment_revision=label_assignment_revision+1,evidence_message_id=null,evidence_quote='',no_reply_reason='',reply_decision_revision=null
 where workspace_id=p_workspace and id=p_conversation and inbound_revision=p_revision and label_assignment_revision=p_assignment;
 if not found then raise exception 'Conversation changed' using errcode='PT409';end if;
end;$$;
revoke all on function public.save_workspace_label(uuid,uuid,integer,jsonb),public.assign_conversation_label(uuid,uuid,uuid,integer,integer) from public,anon;
grant execute on function public.save_workspace_label(uuid,uuid,integer,jsonb),public.assign_conversation_label(uuid,uuid,uuid,integer,integer) to authenticated;

alter table public.agents add column reply_groups text[] not null default array['positive'] check(reply_groups<@array['positive','neutral','negative'] and cardinality(reply_groups)<=3);
update public.agents set reply_groups=case when reply_policy='all' then array['positive','neutral','negative'] else array['positive'] end;
update public.agent_versions set configuration=(configuration-'replyPolicy')||jsonb_build_object('replyGroups',case when configuration->>'replyPolicy'='all' then '["positive","neutral","negative"]'::jsonb else '["positive"]'::jsonb end);
-- Updating existing agents fires their revision trigger. Snapshot that new revision too.
insert into public.agent_versions(workspace_id,agent_id,version,configuration)
 select workspace_id,id,version,jsonb_build_object('name',name,'goal',goal,'language',language,'replyGroups',to_jsonb(reply_groups),'knowledge',knowledge) from public.agents;

-- Legacy workers must fail closed instead of writing multiple labels.
create or replace function public.server_apply_classification(p_workspace uuid,p_conversation uuid,p_revision integer,p_labels text[],p_agent uuid,p_agent_version integer,p_draft text,p_missing text,p_generate boolean,p_run uuid default null,p_connection_revision integer default null)
returns boolean language plpgsql security definer set search_path='' as $$begin raise exception 'Worker upgrade required' using errcode='22023';end;$$;

create function public.server_apply_intent(p_workspace uuid,p_conversation uuid,p_revision integer,p_assignment integer,p_catalog integer,p_config bigint,p_result jsonb,p_agent uuid,p_agent_version integer,p_generate boolean,p_run uuid default null)
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
 if (select a.id from public.workspaces w join public.agents a on a.workspace_id=w.id and a.id=w.default_agent_id and a.status='active' where w.id=p_workspace) is distinct from p_agent or (p_agent is not null and not exists(select 1 from public.agents where workspace_id=p_workspace and id=p_agent and version=p_agent_version and status='active')) then raise exception 'Agent changed' using errcode='PT409';end if;
 v_label=(p_result->>'labelId')::uuid;v_evidence=(p_result->>'evidenceMessageId')::uuid;
 if v_label is not null then
  select * into l from public.workspace_labels where workspace_id=p_workspace and id=v_label and enabled and not archived;
  if not found then raise exception 'Invalid label' using errcode='22023';end if;
  if nullif(btrim(p_result->>'evidenceQuote'),'') is null or length(p_result->>'evidenceQuote')>8000 or not exists(select 1 from public.messages where workspace_id=p_workspace and conversation_id=c.id and id=v_evidence and direction='inbound' and position(p_result->>'evidenceQuote' in body)>0) then raise exception 'Invalid evidence' using errcode='22023';end if;
 elsif v_evidence is not null or coalesce(p_result->>'evidenceQuote','')<>'' then raise exception 'Invalid evidence' using errcode='22023';end if;
 select direction='outbound' into answered from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1;
 eligible=p_generate and v_label is not null and not coalesce(answered,true) and not coalesce((p_result->>'contactStopped')::boolean,false) and exists(select 1 from public.agents a join public.workspaces w on w.id=a.workspace_id and w.default_agent_id=a.id where a.workspace_id=p_workspace and a.id=p_agent and a.version=p_agent_version and a.status='active' and l.intent_group=any(a.reply_groups));
 update public.conversations set label_id=v_label,label_source='ai',label_state=case when v_label is null then 'uncategorized' else 'classified' end,classified_revision=p_revision,
 label_assignment_revision=label_assignment_revision+1,evidence_message_id=v_evidence,evidence_quote=coalesce(p_result->>'evidenceQuote',''),contact_stopped=coalesce((p_result->>'contactStopped')::boolean,false),
 no_reply_reason=case when eligible and not coalesce((p_result->>'shouldReply')::boolean,false) then left(coalesce(p_result->>'noReplyReason',''),1000) else '' end,
 reply_decision_revision=p_revision,reply_agent_id=p_agent,reply_agent_version=p_agent_version,reply_catalog_revision=p_catalog,reply_config_version=p_config
 where workspace_id=p_workspace and id=c.id;
 if eligible and (p_result->>'shouldReply')::boolean and (nullif(btrim(p_result->>'draft'),'') is not null or nullif(btrim(p_result->>'missingKnowledge'),'') is not null) then
  update public.drafts set status='dismissed',revision=revision+1 where workspace_id=p_workspace and conversation_id=c.id and source_revision<p_revision and status in ('ready','needs_input','snoozed');
  insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,missing_knowledge)
  values(p_workspace,c.id,p_agent,p_agent_version,coalesce(p_result->>'draft',''),case when nullif(btrim(p_result->>'missingKnowledge'),'') is null then 'ready' else 'needs_input' end,p_revision,nullif(btrim(p_result->>'missingKnowledge'),''))
  on conflict(workspace_id,conversation_id) where status in ('ready','needs_input','snoozed') do nothing;
 end if;
 if p_run is not null then update app_private.import_items set classified=true where workspace_id=p_workspace and run_id=p_run and conversation_id=c.id;perform app_private.update_import_progress(p_run);end if;
 return true;
end;$$;
revoke all on function public.server_apply_intent(uuid,uuid,integer,integer,integer,bigint,jsonb,uuid,integer,boolean,uuid) from public,anon,authenticated;
grant execute on function public.server_apply_intent(uuid,uuid,integer,integer,integer,bigint,jsonb,uuid,integer,boolean,uuid) to service_role;

create function app_private.track_classification_job() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind='classify' and new.status='failed' then
  update public.conversations set label_state='failed' where workspace_id=new.workspace_id and id::text=new.payload->>'conversationId' and inbound_revision=(new.payload->>'revision')::integer and not coalesce(label_source in ('manual','ai') and classified_revision=inbound_revision,false);
 end if;return new;
end;$$;
revoke all on function app_private.track_classification_job() from public,anon,authenticated;
create trigger classification_job_failure after update of status on app_private.jobs for each row execute function app_private.track_classification_job();
create function public.retry_classification(p_workspace uuid,p_conversation uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.conversations;
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation for update;
 if not found or c.inbound_revision=0 or c.label_state<>'failed' then raise exception 'Nothing to retry' using errcode='22023';end if;
 update public.conversations set label_state='pending' where workspace_id=p_workspace and id=c.id;
 insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'classify','retry:'||gen_random_uuid(),jsonb_build_object('conversationId',c.id,'revision',c.inbound_revision,'generateDraft',false));
end;$$;
revoke all on function public.retry_classification(uuid,uuid) from public,anon;
grant execute on function public.retry_classification(uuid,uuid) to authenticated;

-- Durable, one-time classification-only backfill of stored lead replies.
insert into app_private.jobs(workspace_id,kind,dedup_key,payload)
 select workspace_id,'classify','single-intent-backfill:'||id,jsonb_build_object('conversationId',id,'revision',inbound_revision,'generateDraft',false)
 from public.conversations where inbound_revision>0 on conflict do nothing;

insert into public.ai_config_versions(configuration) values('{"classification":"Determine the lead''s current intent from the development of the conversation, not just the tone of the last message. Select exactly one most appropriate active label ID or null (Unable to categorize). Prefer a specific request over generic interest; custom labels have no automatic priority. A later substantive change overrides earlier intent. Scheduling details, thanks and emoji alone do not erase established intent. Verify the previous assignment against its evidence and the transcript; it may be wrong. Cite an exact excerpt from a supplied inbound message as evidence for a label, using its ID. Never treat our own outbound claims as evidence of the lead''s intent. If context is insufficient or no active definition fits, use labelId=null, evidenceMessageId=null and evidenceQuote=\"\". Contrast examples: ''We use a competitor, but tell me what you offer'' is Information Request; ''We use a competitor, no thanks'' is Not interested. Accepting an offer to send a link or recording is Information Request, NOT Meeting Request; a meeting requires agreeing to a live conversation. A lone name with a question mark, such as ''Alex?'', without clarifying context is Unable to categorize. Explicit contextual example: Team: ''Прислать ссылку на демо?'' Lead: ''👍'' => Information Request, evidence is the emoji message, shouldReply=true, send the approved link. This is a request for materials, not generic Interested and not a scheduled meeting. Team: ''Встреча во вторник в 15:00, приглашение отправлено.'' Lead: ''👍'' after an earlier agreement => retain Meeting Request, shouldReply=false. For labelId=null always set evidenceMessageId=null, evidenceQuote empty, shouldReply=false, draft empty, missingKnowledge empty.","replyDecision":"Decide whether a response is needed separately from intent. Allowed groups permit a draft but do not require one for every incoming message. A thumbs-up after an invitation has been sent generally needs no reply; a thumbs-up accepting our offer to send a link does require fulfilling that offer. If no reply is needed, give a brief user-facing reason. Detect explicit requests to stop contact independently of the chosen label.","draft":"Prepare a concise natural reply for human review, respecting the agent''s goal and language. Answer the lead''s current request using approved knowledge. Do not invent prices, capabilities, URLs, availability or promises. Never claim an action has already been completed when it has not. Avoid unnecessary acknowledgements and repetitive sales pitches.","rewrite":"Revise the existing draft according to the operator''s instructions, preserving factual accuracy and the conversation''s context. Operator style instructions are not evidence for new product claims. Keep the saved label unchanged.","needsInput":"If an essential fact is missing from approved knowledge and the operator''s approved answer, return a precise question in missingKnowledge and leave draft empty. When an approved answer is provided, use it to complete the response. Do not pretend an unanswered question is resolved.","agentTemplate":"Agent name: {{name}}\nGoal: {{goal}}\nReply language: {{language}}\nEligible intent groups: {{replyGroups}}\nApproved knowledge:\n{{knowledge}}","labels":{"interested":"The lead expresses genuine interest without a more specific current request. Do not add this alongside a request category. A question or meeting agreement takes the more specific category.","information_request":"The lead asks for relevant details, pricing, materials or a demo link without agreeing to a meeting. A mere question inside an explicit refusal is not positive intent. Distinguish our outreach questions from the lead''s own requests.","meeting_request":"The lead proposes or accepts a call, meeting or live demo, or coordinates it. Preserve this intent through scheduling questions and acknowledgements. General interest without agreement to meet is insufficient.","referral":"The lead redirects us to a different person or team to contact. A referral is more specific than merely saying they are the wrong person.","not_now":"The lead explicitly defers the conversation to a later period, such as next quarter. Do not infer future interest from an outright refusal without an invitation to return.","wrong_person":"The lead says they are not the appropriate contact and does not provide a referral. Do not confuse a question about our identity with a statement that they are the wrong contact.","not_interested":"The lead currently declines or explicitly has no need for the offer. This overrides incidental questions within the same refusal, but a later genuine request can replace it. Using a competitor alone does not imply refusal."},"defaults":{"goal":"","language":"English","replyGroups":["positive"]}}');
insert into public.ai_config_release(singleton,version_id) select true,id from public.ai_config_versions order by id limit 1;

create or replace function public.save_agent(p_workspace uuid,p_id uuid,p_revision integer,p_config jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare current_row public.agents; new_version integer;
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_config) <> 'object' or length(coalesce(p_config->>'goal','')) > 8000 or length(coalesce(p_config->>'language','')) > 80 then raise exception 'Invalid agent' using errcode='22023'; end if;
  -- Lock the workspace for first-insert races as well as existing agent updates.
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into current_row from public.agents where workspace_id=p_workspace and id=p_id for update;
  if found then
    if current_row.version <> p_revision then raise exception 'Agent changed; reload before saving' using errcode='PT409'; end if;
    update public.agents set name=p_config->>'name', description=coalesce(p_config->>'description',''), goal=coalesce(p_config->>'goal',''),
      language=coalesce(p_config->>'language','English'), reply_groups=array(select jsonb_array_elements_text(coalesce(p_config->'replyGroups','["positive"]'::jsonb))), knowledge=coalesce(p_config->>'knowledge',''), status=p_config->>'status'
      where workspace_id=p_workspace and id=p_id returning version into new_version;
  else
    if p_revision <> 0 then raise exception 'Agent changed or not found' using errcode='PT409'; end if;
    insert into public.agents(id,workspace_id,name,description,goal,language,reply_groups,knowledge,status)
      values(p_id,p_workspace,p_config->>'name',coalesce(p_config->>'description',''),coalesce(p_config->>'goal',''),coalesce(p_config->>'language','English'),array(select jsonb_array_elements_text(coalesce(p_config->'replyGroups','["positive"]'::jsonb))),coalesce(p_config->>'knowledge',''),p_config->>'status') returning version into new_version;
  end if;
  if p_config->>'status' = 'active' then
    insert into public.agent_versions(workspace_id,agent_id,version,configuration)
      select workspace_id,id,version,jsonb_build_object('name',name,'goal',goal,'language',language,'replyGroups',to_jsonb(reply_groups),'knowledge',knowledge)
      from public.agents where workspace_id=p_workspace and id=p_id;
  end if;
  return new_version;
end;
$$;
create or replace function public.conversation_page(p_workspace uuid,p_query text default '',p_label text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50)
returns setof public.conversations language sql stable security invoker set search_path = '' as $$
  select c.* from public.conversations c where c.workspace_id=p_workspace and not c.archived and c.inbound_revision>0
    and (p_query='' or c.contact_name ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%' or c.contact_company ilike '%'||replace(replace(replace(left(p_query,200),'\','\\'),'%','\%'),'_','\_')||'%')
    and (p_label is null or p_label=c.label_id::text or (p_label='uncategorized' and c.label_state='uncategorized' and c.classified_revision=c.inbound_revision) or exists(select 1 from public.workspace_labels l where l.workspace_id=c.workspace_id and l.id=c.label_id and 'group:'||l.intent_group=p_label))
    and (p_before is null or (coalesce(c.last_message_at,c.created_at),c.id)<(p_before,p_before_id))
  order by coalesce(c.last_message_at,c.created_at) desc,c.id desc limit least(greatest(p_limit,1),100);
$$;
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
  select a1.* into a from public.agents a1 join public.workspaces w on w.id=a1.workspace_id and w.default_agent_id=a1.id where w.id=p_workspace and a1.status='active';
  if not found then raise exception 'Select an active agent for workspace replies first' using errcode='22023'; end if;
  if c.contact_stopped or not exists(select 1 from public.workspace_labels where workspace_id=p_workspace and id=c.label_id and enabled and not archived and intent_group=any(a.reply_groups)) or (select direction from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1) is distinct from 'inbound' then raise exception 'Reply is not eligible' using errcode='22023';end if;
  select * into d from public.drafts where workspace_id=p_workspace and conversation_id=p_conversation and status in ('ready','needs_input','snoozed') for update;
  if (d.id is not null and (d.id is distinct from p_draft or d.revision is distinct from p_revision)) or (d.id is null and p_draft is not null) then raise exception 'Draft changed; reload before generating' using errcode='PT409'; end if;
  if p_remember then
    if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Only admins may update Knowledge' using errcode='42501'; end if;
    if nullif(btrim(p_answer),'') is null then raise exception 'Provide an approved answer' using errcode='22023'; end if;
    update public.agents set knowledge=knowledge||E'\n\n'||btrim(p_answer) where workspace_id=p_workspace and id=a.id returning * into a;
    insert into public.agent_versions(workspace_id,agent_id,version,configuration) values(p_workspace,a.id,a.version,jsonb_build_object('name',a.name,'goal',a.goal,'language',a.language,'replyGroups',to_jsonb(a.reply_groups),'knowledge',a.knowledge));
  end if;
  if (select count(*) from public.draft_generations where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=100 then raise exception 'Generation limit reached. Try again later' using errcode='22023'; end if;
  insert into public.draft_generations(workspace_id,id,conversation_id,user_id,agent_id,agent_version,source_revision,expected_draft_id,expected_draft_revision,instructions,approved_answer)
    values(p_workspace,p_id,p_conversation,auth.uid(),a.id,a.version,c.inbound_revision,d.id,d.revision,p_instructions,p_answer);
  insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(p_workspace,'generate',p_id::text,jsonb_build_object('generationId',p_id));
  return p_id;
end;
$$;
create or replace function public.server_complete_generation_v2(p_workspace uuid,p_id uuid,p_body text,p_missing text,p_should_reply boolean,p_config bigint,p_catalog integer,p_assignment integer,p_reason text,p_stopped boolean)
returns void language plpgsql security definer set search_path='' as $$
declare g public.draft_generations; c public.conversations; d public.drafts; failure text; new_id uuid; latest_direction text;
begin
  perform 1 from public.ai_config_release where singleton and version_id=p_config for share;
  if not found then raise exception 'Configuration changed' using errcode='PT409';end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  select * into g from public.draft_generations where workspace_id=p_workspace and id=p_id for update;
  if not found or g.status<>'queued' then return; end if;
  select * into c from public.conversations where workspace_id=p_workspace and id=g.conversation_id for update;
  if not exists(select 1 from public.workspaces where id=p_workspace and label_revision=p_catalog) then raise exception 'Catalog changed' using errcode='PT409';end if;
  if c.label_assignment_revision<>p_assignment then raise exception 'Assignment changed' using errcode='PT409';end if;
  select * into d from public.drafts where workspace_id=p_workspace and conversation_id=c.id and status in ('ready','needs_input','snoozed') for update;
  select direction into latest_direction from public.messages where workspace_id=p_workspace and conversation_id=c.id order by occurred_at desc,id desc limit 1;
  if c.inbound_revision<>g.source_revision or d.id is distinct from g.expected_draft_id or d.revision is distinct from g.expected_draft_revision then failure='context_changed';
  elsif latest_direction is distinct from 'inbound' then failure='context_changed';
  elsif not exists(select 1 from public.workspace_labels l join public.agents a on a.workspace_id=l.workspace_id where l.workspace_id=p_workspace and l.id=c.label_id and l.enabled and not l.archived and a.id=g.agent_id and l.intent_group=any(a.reply_groups)) then failure='label_not_eligible';
  elsif not exists(select 1 from public.agents where workspace_id=p_workspace and id=g.agent_id and version=g.agent_version and status='active') or not exists(select 1 from public.workspaces where id=p_workspace and default_agent_id=g.agent_id) then failure='agent_changed';
  elsif p_should_reply and not p_stopped and nullif(btrim(p_body),'') is null and nullif(btrim(p_missing),'') is null then failure='model_invalid_response';
  end if;
  if failure is not null then update public.draft_generations set status='failed',error_code=failure,updated_at=now() where workspace_id=p_workspace and id=p_id;return;end if;
  update public.conversations set contact_stopped=p_stopped,no_reply_reason=case when not p_should_reply and not p_stopped then left(p_reason,1000) else '' end,reply_decision_revision=c.inbound_revision,reply_agent_id=g.agent_id,reply_agent_version=g.agent_version,reply_catalog_revision=p_catalog,reply_config_version=p_config where workspace_id=p_workspace and id=c.id;
  if not p_should_reply or p_stopped then update public.draft_generations set status='completed',error_code='no_reply_needed',updated_at=now() where workspace_id=p_workspace and id=p_id;return;end if;
  if d.id is not null then
    update public.drafts set body=coalesce(p_body,''),missing_knowledge=nullif(btrim(p_missing),''),status=case when nullif(btrim(p_missing),'') is null then 'ready' else 'needs_input' end,
      source_revision=g.source_revision,agent_id=g.agent_id,agent_version=g.agent_version,revision=revision+1,snoozed_until=null where workspace_id=p_workspace and id=d.id returning id into new_id;
  else
    insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,missing_knowledge)
      values(p_workspace,c.id,g.agent_id,g.agent_version,coalesce(p_body,''),case when nullif(btrim(p_missing),'') is null then 'ready' else 'needs_input' end,g.source_revision,nullif(btrim(p_missing),'')) returning id into new_id;
  end if;
  update public.draft_generations set status='completed',result_draft_id=new_id,updated_at=now() where workspace_id=p_workspace and id=p_id;
end;
$$;
revoke all on function public.server_complete_generation_v2(uuid,uuid,text,text,boolean,bigint,integer,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.server_complete_generation_v2(uuid,uuid,text,text,boolean,bigint,integer,integer,text,boolean) to service_role;
create or replace function public.server_complete_generation(p_workspace uuid,p_id uuid,p_body text,p_missing text,p_should_reply boolean) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'Worker upgrade required' using errcode='22023';end;$$;
create table public.ai_runs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 conversation_id uuid,configuration_version bigint not null references public.ai_config_versions(id),catalog_revision integer not null,
 agent_id uuid,agent_version integer,scenario text not null,model text not null,status text not null default 'running' check(status in ('running','completed','failed')),
 error_code text,created_at timestamptz not null default now(),completed_at timestamptz,
 foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id) on delete cascade
);
alter table public.ai_runs enable row level security;
revoke all on public.ai_runs from public,anon,authenticated;
grant select on public.ai_runs to authenticated;
grant all on public.ai_runs to service_role;
create policy ai_run_owner_read on public.ai_runs for select to authenticated using(public.is_platform_owner() and app_private.has_role(workspace_id));
create index ai_run_recent_idx on public.ai_runs(workspace_id,created_at desc);
alter table public.workspace_labels add constraint reserved_uncategorized_name check(lower(btrim(name))<>'unable to categorize');

-- Operators can inspect a backfill without exposing queue payloads or credentials.
create function public.server_intent_backfill_status() returns table(status text,runs bigint)
language sql stable security definer set search_path='' as $$
select j.status,count(*) from app_private.jobs j where j.kind='classify' and j.dedup_key like 'single-intent-backfill:%' group by j.status;
$$;
revoke all on function public.server_intent_backfill_status() from public,anon,authenticated;
grant execute on function public.server_intent_backfill_status() to service_role;

drop function public.draft_page(uuid,text,text,timestamptz,uuid,integer);
create function public.draft_page(p_workspace uuid,p_status text default null,p_query text default '',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 51,p_label text default null)
returns setof public.drafts language plpgsql stable security definer set search_path='' as $$
declare search text;
begin
 if not app_private.has_role(p_workspace) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_status is not null and p_status not in ('ready','needs_input','snoozed') then raise exception 'Invalid queue' using errcode='22023';end if;
 search=replace(replace(replace(left(coalesce(p_query,''),200),'\','\\'),'%','\%'),'_','\_');
 return query select d.* from public.drafts d join public.conversations c on c.workspace_id=d.workspace_id and c.id=d.conversation_id
 where d.workspace_id=p_workspace and d.status in ('ready','needs_input','snoozed') and (p_status is null or d.status=p_status)
 and (search='' or c.contact_name ilike '%'||search||'%' or c.contact_company ilike '%'||search||'%')
 and (p_label is null or p_label=c.label_id::text or (p_label='uncategorized' and c.label_state='uncategorized' and c.classified_revision=c.inbound_revision) or exists(select 1 from public.workspace_labels l where l.workspace_id=c.workspace_id and l.id=c.label_id and 'group:'||l.intent_group=p_label))
 and (p_before is null or (d.created_at,d.id)<(p_before,p_before_id))
 order by d.created_at desc,d.id desc limit least(greatest(p_limit,1),101);
end;$$;
revoke all on function public.draft_page(uuid,text,text,timestamptz,uuid,integer,text) from public,anon;
grant execute on function public.draft_page(uuid,text,text,timestamptz,uuid,integer,text) to authenticated;
