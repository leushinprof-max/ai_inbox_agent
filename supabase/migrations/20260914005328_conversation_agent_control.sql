-- Per-conversation control is separate from the lead's outcome and agent settings.
alter table public.conversations
 add column agent_enabled boolean not null default true,
 add column agent_control_revision integer not null default 0 check(agent_control_revision>=0);

create or replace function app_private.follow_up_settings(p_workspace uuid,p_conversation uuid) returns jsonb language sql stable set search_path='' as $$
 select a.follow_ups from public.agents a
 join public.conversations c on c.workspace_id=a.workspace_id and c.id=p_conversation and c.agent_enabled
 where a.workspace_id=p_workspace and a.id=app_private.resolve_sender_agent(p_workspace,p_conversation)
 and a.status='active' and (a.follow_ups->>'enabled')::boolean;
$$;

-- Positive admission automatically enters accompaniment. The planner still waits
-- for the operator's actual reply before scheduling the first follow-up.
alter table public.leads alter column status set default 'follow_up';
alter table public.leads alter column state set default 'waiting_reply';
update public.leads set status='follow_up',state='waiting_reply',revision=revision+1 where status='new_interest';
do $$declare l record;begin
 for l in select workspace_id,conversation_id from public.leads where status='follow_up'
 loop perform app_private.plan_follow_up(l.workspace_id,l.conversation_id);end loop;
end;$$;

create function public.set_conversation_agent(p_workspace uuid,p_id uuid,p_revision integer,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare c public.conversations;
begin
 if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_enabled is null then raise exception 'Choose whether the agent is enabled' using errcode='22023';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into c from public.conversations where workspace_id=p_workspace and id=p_id for update;
 if not found then raise exception 'Conversation not found' using errcode='42501';end if;
 if c.agent_control_revision is distinct from p_revision then raise exception 'Agent control changed; reload before continuing' using errcode='PT409';end if;
 if c.agent_enabled=p_enabled then return;end if;
 update public.conversations set agent_enabled=p_enabled,agent_control_revision=agent_control_revision+1 where workspace_id=p_workspace and id=p_id;
 -- Cancel queued/in-flight generation identities, including a quick off/on cycle.
 update public.draft_generations set status='cancelled',updated_at=now() where workspace_id=p_workspace and conversation_id=p_id and status='queued';
 update public.leads set revision=revision+1,due_at=null,error_code=null,
   state=case when status='follow_up' then 'disabled' else state end
 where workspace_id=p_workspace and conversation_id=p_id;
 -- Keep reviewed drafts and send accounting. Resume with a fresh interval, not
 -- a burst of overdue messages. Inbound-last conversations still await our reply.
 if p_enabled then
   if (select direction from public.messages where workspace_id=p_workspace and conversation_id=p_id order by occurred_at desc,id desc limit 1)='outbound' then
     perform app_private.plan_follow_up(p_workspace,p_id,now());
   else perform app_private.plan_follow_up(p_workspace,p_id);end if;
 end if;
end;$$;
revoke all on function public.set_conversation_agent(uuid,uuid,integer,boolean) from public,anon;
grant execute on function public.set_conversation_agent(uuid,uuid,integer,boolean) to authenticated;

-- Explicit rewrite/generation requests also respect the conversation switch.
create function app_private.guard_conversation_generation() returns trigger language plpgsql set search_path='' as $$
begin
 perform 1 from public.workspaces where id=new.workspace_id for update;
 if not exists(select 1 from public.conversations where workspace_id=new.workspace_id and id=new.conversation_id and agent_enabled) then
   raise exception 'Turn on the agent for this conversation before generating a draft' using errcode='22023';
 end if;
 return new;
end;$$;
revoke all on function app_private.guard_conversation_generation() from public,anon,authenticated;
create trigger guard_conversation_generation before insert on public.draft_generations for each row execute function app_private.guard_conversation_generation();

-- Classification continues while the agent is off. Draft publication is fenced
-- under the same workspace lock as the switch, including off/on races.
alter function public.server_apply_intent(uuid,uuid,integer,integer,integer,bigint,jsonb,uuid,integer,boolean,uuid) set schema app_private;
revoke all on function app_private.server_apply_intent(uuid,uuid,integer,integer,integer,bigint,jsonb,uuid,integer,boolean,uuid) from public,anon,authenticated,service_role;
create function public.server_apply_intent(p_workspace uuid,p_conversation uuid,p_revision integer,p_assignment integer,p_catalog integer,p_config bigint,p_result jsonb,p_agent uuid,p_agent_version integer,p_generate boolean,p_run uuid default null,p_agent_control_revision integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare enabled boolean; control_revision integer;
begin
 -- Match lock order of the original completion function.
 perform 1 from public.ai_config_release where singleton for share;
 perform 1 from public.workspaces where id=p_workspace for update;
 select agent_enabled,agent_control_revision into enabled,control_revision from public.conversations where workspace_id=p_workspace and id=p_conversation;
 return app_private.server_apply_intent(p_workspace,p_conversation,p_revision,p_assignment,p_catalog,p_config,p_result,p_agent,p_agent_version,
   p_generate and coalesce(enabled,false) and (p_agent_control_revision is null or p_agent_control_revision=control_revision),p_run);
end;$$;
revoke all on function public.server_apply_intent(uuid,uuid,integer,integer,integer,bigint,jsonb,uuid,integer,boolean,uuid,integer) from public,anon,authenticated;
grant execute on function public.server_apply_intent(uuid,uuid,integer,integer,integer,bigint,jsonb,uuid,integer,boolean,uuid,integer) to service_role;
notify pgrst,'reload schema';
