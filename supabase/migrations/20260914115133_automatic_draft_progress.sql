-- Automatic replies run as classification jobs, not draft_generations. Expose
-- only review progress to workspace members; job payloads and AI prompts stay private.
create or replace function app_private.automatic_draft_progress(p_workspace uuid)
returns table(id uuid, conversation_id uuid, source_revision integer, status text,
  error_code text, draft_id uuid, result_revision integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not app_private.has_role(p_workspace) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  return query
  with latest as (
    select distinct on (j.payload->>'conversationId') j.*
    from app_private.jobs j
    where j.workspace_id=p_workspace and j.kind='classify'
      and j.payload->>'generateDraft'='true'
      and (j.status in ('queued','running') or j.created_at > now()-interval '1 day')
    order by j.payload->>'conversationId',j.created_at desc,j.id desc
  )
  select j.id,c.id,c.inbound_revision,
    case
      when not c.agent_enabled or c.contact_stopped or a.id is null
        or m.direction is distinct from 'inbound' then 'cancelled'
      when j.status in ('queued','running') then 'queued'
      when j.status='failed' then 'failed'
      else 'completed'
    end,
    case when j.status='done' and d.id is null then 'no_reply_needed' else j.error_code end,
    d.id,coalesce(d.revision,1)
  from latest j
  join public.conversations c on c.workspace_id=j.workspace_id
    and c.id::text=j.payload->>'conversationId'
    and c.inbound_revision::text=j.payload->>'revision'
  join public.workspaces w on w.id=c.workspace_id
  left join public.senders s on s.workspace_id=c.workspace_id and s.provider_id=c.sender_id
  left join public.agents a on a.workspace_id=c.workspace_id
    and a.id=coalesce(s.agent_id,w.default_agent_id) and a.status='active'
  left join lateral (
    select msg.direction from public.messages msg
    where msg.workspace_id=c.workspace_id and msg.conversation_id=c.id
    order by msg.occurred_at desc,msg.id desc limit 1
  ) m on true
  left join public.drafts d on d.workspace_id=c.workspace_id and d.conversation_id=c.id
    and d.source_revision=c.inbound_revision and d.follow_up_number is null
    and d.status in ('ready','needs_input','snoozed')
  where not c.archived
  order by j.created_at desc,j.id desc;
end;
$$;
revoke all on function app_private.automatic_draft_progress(uuid) from public,anon;
grant execute on function app_private.automatic_draft_progress(uuid) to authenticated;

create or replace function public.automatic_draft_progress(p_workspace uuid)
returns table(id uuid, conversation_id uuid, source_revision integer, status text,
  error_code text, draft_id uuid, result_revision integer)
language sql stable security invoker set search_path='' as $$
  select * from app_private.automatic_draft_progress(p_workspace);
$$;
revoke all on function public.automatic_draft_progress(uuid) from public,anon;
grant execute on function public.automatic_draft_progress(uuid) to authenticated;
notify pgrst,'reload schema';
