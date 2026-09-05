-- Standalone application schema. Apply only to a new, dedicated Supabase project.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 80),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id, workspace_id);

-- The non-exposed helper avoids recursive membership RLS. The authenticated caller is always checked.
create function app_private.has_role(p_workspace uuid, p_roles text[] default array['owner','admin','member','viewer'])
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.role = any(p_roles)
  );
$$;
revoke all on function app_private.has_role(uuid,text[]) from public, anon;
grant execute on function app_private.has_role(uuid,text[]) to authenticated;

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 1000),
  status text not null default 'draft' check (status in ('draft','active','paused')),
  goal text not null default '',
  language text not null default 'English',
  reply_policy text not null default 'positive' check (reply_policy in ('positive','all')),
  knowledge text not null default '' check (length(knowledge) <= 30000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (status <> 'active' or (length(btrim(knowledge)) > 0 and length(btrim(goal)) > 0))
);
create index agents_workspace_idx on public.agents(workspace_id, status);

create table public.connections (
  workspace_id uuid primary key references public.workspaces(id),
  status text not null default 'disconnected' check (status in ('disconnected','connected','invalid_key')),
  webhook_status text not null default 'not_configured' check (webhook_status in ('not_configured','waiting','receiving')),
  last_event_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.connections is 'Public connection status only. No API keys or webhook secrets are stored here.';

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  provider_conversation_id text not null,
  sender_id bigint not null check (sender_id > 0),
  sender_name text not null,
  contact_name text not null,
  contact_company text not null default '',
  contact_position text not null default '',
  campaign text not null default '',
  labels text[] not null default '{}',
  inbound_revision integer not null default 0 check (inbound_revision >= 0),
  notes text not null default '' check (length(notes) <= 8000),
  archived boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sender_id, provider_conversation_id)
);
create index conversations_workspace_recent_idx on public.conversations(workspace_id, last_message_at desc, id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  conversation_id uuid not null,
  ingestion_key text not null,
  body text not null,
  direction text not null check (direction in ('inbound','outbound')),
  source text not null check (source in ('provider','accepted_send')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, conversation_id) references public.conversations(workspace_id, id),
  unique (workspace_id, conversation_id, ingestion_key)
);
create index messages_conversation_idx on public.messages(workspace_id, conversation_id, occurred_at, id);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  conversation_id uuid not null,
  agent_id uuid not null,
  agent_version integer not null check (agent_version > 0),
  body text not null default '' check (length(body) <= 8000),
  status text not null check (status in ('ready','needs_input','snoozed','sent','dismissed')),
  source_revision integer not null check (source_revision >= 0),
  revision integer not null default 1 check (revision > 0),
  missing_knowledge text,
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, conversation_id) references public.conversations(workspace_id, id),
  foreign key (workspace_id, agent_id) references public.agents(workspace_id, id),
  unique (workspace_id, id),
  check (status <> 'snoozed' or snoozed_until is not null),
  check (status <> 'ready' or length(btrim(body)) > 0)
);
create index drafts_queue_idx on public.drafts(workspace_id, status, created_at desc);
create unique index drafts_one_open_idx on public.drafts(workspace_id, conversation_id)
where status in ('ready','needs_input','snoozed');

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.agents enable row level security;
alter table public.connections enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.drafts enable row level security;

revoke all on public.workspaces, public.workspace_members, public.agents, public.connections, public.conversations, public.messages, public.drafts from public, anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.agents, public.connections, public.conversations, public.messages, public.drafts to authenticated;
grant update(name, timezone) on public.workspaces to authenticated;
grant insert(workspace_id, name, description, goal, language, reply_policy, knowledge, status) on public.agents to authenticated;
grant update(name, description, goal, language, reply_policy, knowledge, status) on public.agents to authenticated;
grant update(notes, archived) on public.conversations to authenticated;

create policy workspace_read on public.workspaces for select to authenticated using (app_private.has_role(id));
create policy workspace_update on public.workspaces for update to authenticated using (app_private.has_role(id,array['owner','admin'])) with check (app_private.has_role(id,array['owner','admin']));
create policy member_read on public.workspace_members for select to authenticated using (app_private.has_role(workspace_id));
create policy agent_read on public.agents for select to authenticated using (app_private.has_role(workspace_id));
create policy agent_insert on public.agents for insert to authenticated with check (app_private.has_role(workspace_id,array['owner','admin']));
create policy agent_update on public.agents for update to authenticated using (app_private.has_role(workspace_id,array['owner','admin'])) with check (app_private.has_role(workspace_id,array['owner','admin']));
create policy connection_read on public.connections for select to authenticated using (app_private.has_role(workspace_id));
create policy conversation_read on public.conversations for select to authenticated using (app_private.has_role(workspace_id));
create policy conversation_update on public.conversations for update to authenticated using (app_private.has_role(workspace_id,array['owner','admin','member'])) with check (app_private.has_role(workspace_id,array['owner','admin','member']));
create policy message_read on public.messages for select to authenticated using (app_private.has_role(workspace_id));
create policy draft_read on public.drafts for select to authenticated using (app_private.has_role(workspace_id));

create function app_private.increment_agent_version() returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;
revoke all on function app_private.increment_agent_version() from public, anon, authenticated;
create trigger agent_version before update on public.agents for each row execute function app_private.increment_agent_version();

create function public.create_workspace(p_name text, p_timezone text default 'UTC') returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'Invalid workspace name' using errcode = '22023'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name = p_timezone) then raise exception 'Invalid timezone' using errcode = '22023'; end if;
  insert into public.workspaces(name, timezone) values (btrim(p_name), p_timezone) returning id into new_id;
  insert into public.workspace_members(workspace_id, user_id, role) values (new_id, auth.uid(), 'owner');
  insert into public.connections(workspace_id) values (new_id);
  return new_id;
end;
$$;
revoke all on function public.create_workspace(text,text) from public, anon;
grant execute on function public.create_workspace(text,text) to authenticated;

create function public.update_draft(p_workspace uuid, p_id uuid, p_revision integer, p_body text, p_status text, p_snoozed_until timestamptz default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare new_revision integer;
begin
  if not app_private.has_role(p_workspace,array['owner','admin','member']) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('ready','snoozed','dismissed') then raise exception 'Invalid draft action' using errcode = '22023'; end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 8000 then raise exception 'Invalid reply' using errcode = '22023'; end if;
  if p_status = 'snoozed' and (p_snoozed_until is null or p_snoozed_until <= now()) then raise exception 'Choose a future time' using errcode = '22023'; end if;
  update public.drafts set body = btrim(p_body), status = p_status,
    snoozed_until = case when p_status = 'snoozed' then p_snoozed_until else null end, revision = revision + 1
    where workspace_id = p_workspace and id = p_id and revision = p_revision and status in ('ready','snoozed')
    returning revision into new_revision;
  if new_revision is null then raise exception 'Draft changed or not found' using errcode = '40001'; end if;
  return new_revision;
end;
$$;
revoke all on function public.update_draft(uuid,uuid,integer,text,text,timestamptz) from public, anon;
grant execute on function public.update_draft(uuid,uuid,integer,text,text,timestamptz) to authenticated;
