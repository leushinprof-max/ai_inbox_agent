-- Admission is independent of classification and reply-generation groups.
alter table public.workspace_labels add column add_to_leads boolean;
update public.workspace_labels set add_to_leads = intent_group='positive';
alter table public.workspace_labels alter column add_to_leads set not null;

create function app_private.default_lead_admission() returns trigger
language plpgsql set search_path='' as $$
begin
 new.add_to_leads := coalesce(new.add_to_leads, new.intent_group='positive');
 return new;
end;$$;
create trigger default_lead_admission before insert on public.workspace_labels
for each row execute function app_private.default_lead_admission();
revoke all on function app_private.default_lead_admission() from public,anon,authenticated;

create or replace function app_private.track_lead_conversation() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.leads;m public.messages;
begin
 if new.inbound_revision>0 and exists(select 1 from public.workspace_labels where workspace_id=new.workspace_id and id=new.label_id and add_to_leads) then
  insert into public.leads(workspace_id,conversation_id,series_revision) values(new.workspace_id,new.id,new.inbound_revision) on conflict do nothing;
 end if;
 select * into l from public.leads where workspace_id=new.workspace_id and conversation_id=new.id for update;
 if not found then return new;end if;
 if tg_op='UPDATE' and new.inbound_revision<>old.inbound_revision then
  update public.leads set revision=revision+1,state=case when status='follow_up' then 'waiting_reply' else state end,due_at=null,error_code=null where workspace_id=new.workspace_id and conversation_id=new.id;
  update public.drafts set status='dismissed',revision=revision+1 where workspace_id=new.workspace_id and conversation_id=new.id and follow_up_number is not null and status in ('ready','needs_input','snoozed');
 end if;
 if l.status='follow_up' then
  -- An unresolved send owns its draft until delivery is known.
  if exists(select 1 from public.send_operations where workspace_id=new.workspace_id and conversation_id=new.id and status in ('sending','unknown')) then return new;end if;
  select * into m from public.messages where workspace_id=new.workspace_id and conversation_id=new.id order by occurred_at desc,id desc limit 1;
  if m.id is distinct from l.anchor_id then
   update public.drafts set status='dismissed',revision=revision+1 where workspace_id=new.workspace_id and conversation_id=new.id and follow_up_number is not null and status in ('ready','needs_input','snoozed');
  end if;
  perform app_private.plan_follow_up(new.workspace_id,new.id);
 end if;
 return new;
end;$$;

-- System-label classification rules remain immutable.
create function public.set_label_lead_admission(p_workspace uuid,p_label uuid,p_revision integer,p_enabled boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare l public.workspace_labels;c record;added integer:=0;
begin
 if not app_private.has_role(p_workspace,array['owner','admin']) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'Choose whether to add to Leads' using errcode='22023';end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into l from public.workspace_labels where workspace_id=p_workspace and id=p_label for update;
 if not found or l.revision<>p_revision then raise exception 'Label changed. Refresh and try again.' using errcode='PT409';end if;
 update public.workspace_labels set add_to_leads=p_enabled,revision=revision+1 where workspace_id=p_workspace and id=p_label;
 if p_enabled then
  -- Only newly admitted rows are planned. Existing outcomes and schedules survive.
  for c in
   insert into public.leads(workspace_id,conversation_id,series_revision)
   select workspace_id,id,inbound_revision from public.conversations
   where workspace_id=p_workspace and label_id=p_label and inbound_revision>0
   on conflict do nothing returning conversation_id
  loop
   perform app_private.plan_follow_up(p_workspace,c.conversation_id);
   added:=added+1;
  end loop;
 end if;
 return added;
end;$$;
revoke all on function public.set_label_lead_admission(uuid,uuid,integer,boolean) from public,anon;
grant execute on function public.set_label_lead_admission(uuid,uuid,integer,boolean) to authenticated;
