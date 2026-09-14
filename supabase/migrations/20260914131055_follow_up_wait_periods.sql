-- Per-attempt waits replace random ranges. Existing saved dates and version
-- snapshots remain intact; old settings resolve to the rounded range midpoint.
create or replace function app_private.valid_follow_ups(v jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare minimum text := coalesce(v->>'minDays','2');
        maximum text := coalesce(v->>'maxDays','4');
begin
  if jsonb_typeof(v) is distinct from 'object'
    or jsonb_typeof(v->'enabled') is distinct from 'boolean'
    or coalesce(v->>'attempts','') !~ '^[1-5]$'
    or minimum !~ '^[0-9]{1,3}$' or maximum !~ '^[0-9]{1,3}$'
  then return false; end if;
  if minimum::integer not between 1 and 365
    or maximum::integer not between minimum::integer and 365
    or jsonb_typeof(v->'instructions') is distinct from 'string'
    or length(v->>'instructions') > 8000
    or jsonb_typeof(v->'examples') is distinct from 'array'
  then return false; end if;
  if v ? 'waitDays' then
    if jsonb_typeof(v->'waitDays') is distinct from 'array' then return false; end if;
    if jsonb_array_length(v->'waitDays') <> (v->>'attempts')::integer
      or exists(select 1 from jsonb_array_elements(v->'waitDays') day
        where jsonb_typeof(day) <> 'number' or day#>>'{}' !~ '^[0-9]{1,3}$')
    then return false; end if;
    if exists(select 1 from jsonb_array_elements_text(v->'waitDays') day
      where day::integer not between 1 and 365)
    then return false; end if;
  end if;
  return jsonb_array_length(v->'examples') <= 3
    and not exists(select 1 from jsonb_array_elements(v->'examples') e
      where jsonb_typeof(e) <> 'string' or length(btrim(e#>>'{}')) not between 1 and 4000);
end;$$;

create function app_private.follow_up_delay(settings jsonb, p_attempt integer)
returns interval language sql immutable set search_path='' as $$
  select make_interval(days => case
    when jsonb_typeof(settings->'waitDays') = 'array' then
      (settings->'waitDays'->>greatest(0, least(p_attempt, jsonb_array_length(settings->'waitDays')) - 1))::integer
    else round((coalesce((settings->>'minDays')::numeric,2)
      + coalesce((settings->>'maxDays')::numeric,4)) / 2)::integer
    end);
$$;
revoke all on function app_private.follow_up_delay(jsonb,integer) from public,anon,authenticated;

-- Keep the old signature available to existing callers during rollout.
create or replace function app_private.follow_up_delay(settings jsonb)
returns interval language sql immutable set search_path='' as $$
  select app_private.follow_up_delay(settings,1);
$$;

create or replace function app_private.plan_follow_up(
  p_workspace uuid,p_conversation uuid,p_anchor timestamptz default null
) returns void language plpgsql set search_path='' as $$
declare l public.leads;c public.conversations;m public.messages;settings jsonb;next_state text;
begin
  select * into l from public.leads where workspace_id=p_workspace and conversation_id=p_conversation for update;
  if not found or l.status<>'follow_up' then return;end if;
  select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation;
  select * into m from public.messages where workspace_id=p_workspace and conversation_id=p_conversation order by occurred_at desc,id desc limit 1;
  settings=app_private.follow_up_settings(p_workspace,p_conversation);
  if settings is null then next_state='disabled';
  elsif m.id is null or (m.direction<>'outbound' and p_anchor is null) then next_state='waiting_reply';
  elsif exists(select 1 from public.drafts where workspace_id=p_workspace and conversation_id=p_conversation and status in ('ready','needs_input','snoozed')) then next_state='draft';
  else next_state='scheduled';end if;
  if next_state<>'scheduled' then
    update public.leads set state=next_state,due_at=null,error_code=null,revision=revision+1 where workspace_id=p_workspace and conversation_id=p_conversation and (state<>next_state or due_at is not null);
    return;
  end if;
  if p_anchor is null and l.anchor_id=m.id and l.state in ('scheduled','queued','error') then return;end if;
  update public.leads set state='scheduled',
    due_at=coalesce(p_anchor,m.occurred_at)+app_private.follow_up_delay(settings,
      case when l.series_revision<>c.inbound_revision then 1 else l.sent_count+1 end),
    anchor_id=m.id,
    sent_count=case when series_revision<>c.inbound_revision then 0 else sent_count end,
    series_revision=c.inbound_revision,error_code=null,revision=revision+1
  where workspace_id=p_workspace and conversation_id=p_conversation;
end;$$;
