-- Explicit user requests can rerun successful as well as failed classifications.
create or replace function public.retry_classification(p_workspace uuid, p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  if not app_private.has_role(p_workspace, array['owner','admin','member']) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform 1 from public.workspaces where id = p_workspace for update;
  select * into c from public.conversations
    where workspace_id = p_workspace and id = p_conversation for update;
  if not found or c.inbound_revision = 0 then
    raise exception 'No lead replies to classify' using errcode = '22023';
  end if;
  if c.label_state = 'pending' then return; end if;

  -- Retain the old label and evidence until a result arrives. Invalidate older
  -- results and allow this explicit request to replace a manually assigned label.
  update public.conversations
    set label_state = 'pending', classified_revision = 0,
        label_assignment_revision = label_assignment_revision + 1
    where workspace_id = p_workspace and id = c.id
    returning * into c;
  insert into app_private.jobs(workspace_id, kind, dedup_key, payload)
    values(p_workspace, 'classify', 'retry:' || gen_random_uuid(),
      jsonb_build_object('conversationId', c.id, 'revision', c.inbound_revision,
        'assignmentRevision', c.label_assignment_revision,
        'reclassify', true, 'generateDraft', false));
end;
$$;
revoke all on function public.retry_classification(uuid,uuid) from public,anon;
grant execute on function public.retry_classification(uuid,uuid) to authenticated;

create or replace function app_private.track_classification_job()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = 'classify' and new.status = 'failed' then
    update public.conversations set label_state = 'failed'
      where workspace_id = new.workspace_id
        and id::text = new.payload->>'conversationId'
        and inbound_revision = (new.payload->>'revision')::integer
        and (not (new.payload ? 'assignmentRevision')
          or label_assignment_revision = (new.payload->>'assignmentRevision')::integer)
        and not coalesce(label_source in ('manual','ai') and classified_revision = inbound_revision, false);
  end if;
  return new;
end;
$$;
revoke all on function app_private.track_classification_job() from public,anon,authenticated;
