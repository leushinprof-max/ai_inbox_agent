create or replace function public.server_schedule_follow_ups() returns integer language plpgsql security definer set search_path='' as $$
declare candidate record;l public.leads;settings jsonb;m public.messages;j app_private.jobs;n integer=0;
begin
 for candidate in
  select workspace_id,conversation_id from public.leads
  where (status='later' and later_until<=now()) or (status='follow_up' and state='scheduled' and due_at<=now())
   or (status='follow_up' and state='queued' and exists(select 1 from app_private.jobs job where job.workspace_id=leads.workspace_id and job.kind='follow_up' and job.dedup_key=leads.conversation_id::text||':'||leads.revision::text and job.status in ('failed','done')))
   or (status='follow_up' and state='disabled' and app_private.follow_up_settings(workspace_id,conversation_id) is not null)
   or (status='follow_up' and state='waiting_reply' and app_private.follow_up_settings(workspace_id,conversation_id) is not null
       and (select direction from public.messages msg where msg.workspace_id=leads.workspace_id and msg.conversation_id=leads.conversation_id order by occurred_at desc,id desc limit 1)='outbound'
       and not exists(select 1 from public.drafts d where d.workspace_id=leads.workspace_id and d.conversation_id=leads.conversation_id and d.status in ('ready','needs_input','snoozed')))
  order by coalesce(due_at,later_until,entered_at),workspace_id,conversation_id limit 50
 loop
  -- All writers acquire the workspace before its lead/draft rows.
  perform 1 from public.workspaces where id=candidate.workspace_id for update skip locked;
  if not found then continue;end if;
  select * into l from public.leads where workspace_id=candidate.workspace_id and conversation_id=candidate.conversation_id for update;
  if l.status='follow_up' and l.state='queued' then
   -- Reconcile terminal jobs while holding workspace first. A job-row trigger
   -- would reverse the lock order used by scheduler and generation writers.
   select * into j from app_private.jobs where workspace_id=l.workspace_id and kind='follow_up' and dedup_key=l.conversation_id::text||':'||l.revision::text and status in ('failed','done');
   if found then
    update public.leads set state=case when j.status='failed' then 'error' else 'disabled' end,error_code=case when j.status='failed' then j.error_code else null end,due_at=null,revision=revision+1 where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
   end if;
   continue;
  end if;
  if l.status='later' and l.later_until<=now() then
   select * into m from public.messages where workspace_id=l.workspace_id and conversation_id=l.conversation_id order by occurred_at desc,id desc limit 1;
   update public.leads set status='follow_up',later_until=null,state='scheduled',due_at=now(),anchor_id=m.id,sent_count=0,
    series_revision=(select inbound_revision from public.conversations where workspace_id=l.workspace_id and id=l.conversation_id),revision=revision+1,error_code=null
   where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
  elsif l.status='follow_up' and l.state in ('disabled','waiting_reply') then
   perform app_private.plan_follow_up(l.workspace_id,l.conversation_id);
  end if;
  select * into l from public.leads where workspace_id=candidate.workspace_id and conversation_id=candidate.conversation_id;
  if l.status<>'follow_up' or l.state<>'scheduled' or l.due_at>now() or l.due_at is null then continue;end if;
  settings=app_private.follow_up_settings(l.workspace_id,l.conversation_id);
  if settings is null then
   update public.leads set state='disabled',due_at=null,revision=revision+1 where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
   continue;
  end if;
  if exists(select 1 from public.send_operations where workspace_id=l.workspace_id and conversation_id=l.conversation_id and status in ('sending','unknown')) then continue;end if;
  if exists(select 1 from public.drafts where workspace_id=l.workspace_id and conversation_id=l.conversation_id and status in ('ready','needs_input','snoozed')) then
   update public.leads set state='draft',due_at=null where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
   continue;
  end if;
  if exists(select 1 from public.draft_generations where workspace_id=l.workspace_id and conversation_id=l.conversation_id and status='queued') then continue;end if;
  if l.sent_count>=(settings->>'attempts')::integer then
   update public.leads set status='no_reply',state='finished',due_at=null,revision=revision+1 where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
  else
   insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values(l.workspace_id,'follow_up',l.conversation_id::text||':'||l.revision::text,jsonb_build_object('conversationId',l.conversation_id,'leadRevision',l.revision)) on conflict do nothing;
   update public.leads set state='queued' where workspace_id=l.workspace_id and conversation_id=l.conversation_id;
  end if;
  n=n+1;
 end loop;
 return n;
end;$$;
