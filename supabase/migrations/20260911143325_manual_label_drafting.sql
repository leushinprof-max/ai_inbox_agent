-- Manual intent selection and its draft request commit together. The existing
-- generation worker uses the selected label in reply mode without reclassifying.
create or replace function public.assign_conversation_label(
  p_workspace uuid, p_conversation uuid, p_label uuid,
  p_revision integer, p_assignment integer
) returns void language plpgsql security definer set search_path = '' as $$
declare c public.conversations; a public.agents;
begin
  if not app_private.has_role(p_workspace, array['owner','admin','member']) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform 1 from public.workspaces where id = p_workspace for update;
  if p_label is not null and not exists (
    select 1 from public.workspace_labels
    where workspace_id = p_workspace and id = p_label and enabled and not archived
  ) then
    raise exception 'Label unavailable' using errcode = '22023';
  end if;
  select * into c from public.conversations
    where workspace_id = p_workspace and id = p_conversation for update;
  if not found or c.inbound_revision is distinct from p_revision
    or c.label_assignment_revision is distinct from p_assignment then
    raise exception 'Conversation changed' using errcode = 'PT409';
  end if;
  if c.inbound_revision = 0 then
    raise exception 'No lead replies to classify' using errcode = '22023';
  end if;
  if c.label_source = 'manual' and c.label_id is not distinct from p_label
    and c.classified_revision = c.inbound_revision
    and c.label_state in ('classified','manual_clear') then return; end if;

  update public.conversations
    set label_id = p_label, label_source = 'manual',
        label_state = case when p_label is null then 'manual_clear' else 'classified' end,
        classified_revision = inbound_revision,
        label_assignment_revision = label_assignment_revision + 1,
        evidence_message_id = null, evidence_quote = '', no_reply_reason = '',
        reply_decision_revision = null
    where workspace_id = p_workspace and id = c.id;

  -- A queued/running writer for an older selection must not publish a reply,
  -- even if it has not loaded its context yet. Completed human drafts stay intact.
  update public.draft_generations
    set status = 'cancelled', updated_at = now()
    where workspace_id = p_workspace and conversation_id = c.id and status = 'queued';

  select * into a from public.agents
    where workspace_id = p_workspace
      and id = app_private.resolve_sender_agent(p_workspace, c.id);
  if a.id is not null and not c.archived and not c.contact_stopped
    and exists (
      select 1 from public.workspace_labels
      where workspace_id = p_workspace and id = p_label
        and enabled and not archived and intent_group = any(a.reply_groups)
    )
    and (select direction from public.messages
      where workspace_id = p_workspace and conversation_id = c.id
      order by occurred_at desc, id desc limit 1) = 'inbound'
    and not exists (
      select 1 from public.drafts where workspace_id = p_workspace
        and conversation_id = c.id and status in ('ready','needs_input','snoozed')
    ) then
    perform public.request_draft_generation(p_workspace, gen_random_uuid(), c.id, c.inbound_revision);
  end if;
end;
$$;
revoke all on function public.assign_conversation_label(uuid,uuid,uuid,integer,integer) from public,anon;
grant execute on function public.assign_conversation_label(uuid,uuid,uuid,integer,integer) to authenticated;
