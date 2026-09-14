-- Private destinations and tokens are accessed only through scoped RPCs.
create table app_private.telegram_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 id uuid not null unique default gen_random_uuid(),
 bot_id bigint not null,
 telegram_user_id bigint not null,
 chat_id bigint not null,
 username text,
 display_name text not null,
 blocked boolean not null default false,
 connected_at timestamptz not null default now(),
 unique(bot_id,telegram_user_id),
 check(telegram_user_id>0 and chat_id=telegram_user_id)
);
create table app_private.telegram_links (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 bot_id bigint not null,
 expires_at timestamptz not null default now()+interval '10 minutes',
 consumed_by bigint,
 created_at timestamptz not null default now()
);
create index telegram_links_user_idx on app_private.telegram_links(user_id);
create index telegram_links_workspace_idx on app_private.telegram_links(workspace_id);
create table app_private.notification_subscriptions (
 workspace_id uuid not null,
 user_id uuid not null,
 channel text not null default 'telegram' check(channel='telegram'),
 event text not null default 'draft_ready' check(event='draft_ready'),
 enabled boolean not null default true,
 primary key(workspace_id,user_id,channel,event),
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create index notification_subscriptions_user_idx on app_private.notification_subscriptions(user_id);
create table app_private.notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 connection_id uuid not null,
 bot_id bigint not null,
 draft_id uuid,
 draft_revision integer,
 source_revision integer,
 draft_body text not null default '',
 missing_knowledge text,
 inbound_body text not null default '',
 kind text not null check(kind in ('draft','test')),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 message_id bigint,
 rendered_text text,
 approval_allowed boolean not null default false,
 refresh_requested boolean not null default false,
 operation_id uuid not null unique default gen_random_uuid(),
 error_code text,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,draft_id) references public.drafts(workspace_id,id),
 unique(user_id,draft_id,draft_revision),
 check((kind='draft' and draft_id is not null and draft_revision is not null and source_revision is not null) or (kind='test' and draft_id is null))
);
create index notification_deliveries_due_idx on app_private.notification_deliveries(bot_id,available_at) where status in ('pending','sending') or refresh_requested;
create index notification_deliveries_user_idx on app_private.notification_deliveries(user_id,workspace_id,created_at desc);
create index notification_deliveries_draft_idx on app_private.notification_deliveries(workspace_id,draft_id);
alter table app_private.telegram_connections enable row level security;
alter table app_private.telegram_links enable row level security;
alter table app_private.notification_subscriptions enable row level security;
alter table app_private.notification_deliveries enable row level security;
revoke all on app_private.telegram_connections,app_private.telegram_links,app_private.notification_subscriptions,app_private.notification_deliveries from public,anon,authenticated,service_role;

create function public.get_notification_settings(p_workspace uuid,p_bot bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c app_private.telegram_connections; enabled boolean; last_error text;
begin
 if not app_private.has_role(p_workspace) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into c from app_private.telegram_connections where user_id=auth.uid() and bot_id=p_bot;
 select s.enabled into enabled from app_private.notification_subscriptions s where workspace_id=p_workspace and user_id=auth.uid() and channel='telegram' and event='draft_ready';
 select error_code into last_error from app_private.notification_deliveries where workspace_id=p_workspace and user_id=auth.uid() and bot_id=p_bot order by created_at desc limit 1;
 return jsonb_build_object('connected',c.id is not null and not c.blocked,'username',c.username,'displayName',c.display_name,'enabled',coalesce(enabled,false),'blocked',coalesce(c.blocked,false),'lastError',last_error);
end;$$;

create function public.create_telegram_link(p_workspace uuid,p_bot bigint,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not app_private.has_role(p_workspace) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_bot is null or p_bot<=0 then raise exception 'Invalid bot' using errcode='22023';end if;
 delete from app_private.telegram_links where user_id=auth.uid() or expires_at<now();
 insert into app_private.telegram_links(token_hash,user_id,workspace_id,bot_id) values(p_hash,auth.uid(),p_workspace,p_bot);
end;$$;

create function public.server_connect_telegram(p_bot bigint,p_hash text,p_telegram bigint,p_chat bigint,p_username text default null,p_name text default 'Telegram user')
returns boolean language plpgsql security definer set search_path='' as $$
declare link app_private.telegram_links;
begin
 if p_telegram is null or p_telegram<=0 or p_chat is distinct from p_telegram or length(coalesce(p_name,''))>200 or length(coalesce(p_username,''))>64 then raise exception 'Invalid account' using errcode='22023';end if;
 select * into link from app_private.telegram_links where token_hash=p_hash and bot_id=p_bot and expires_at>now() for update;
 if not found then raise exception 'Link expired' using errcode='PT409';end if;
 if link.consumed_by=p_telegram then return false;end if;
 if link.consumed_by is not null then raise exception 'Link used' using errcode='PT409';end if;
 perform 1 from public.workspace_members where workspace_id=link.workspace_id and user_id=link.user_id for share;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 insert into app_private.telegram_connections(user_id,bot_id,telegram_user_id,chat_id,username,display_name)
 values(link.user_id,p_bot,p_telegram,p_chat,p_username,coalesce(nullif(p_name,''),'Telegram user'))
 on conflict(user_id) do update set id=gen_random_uuid(),bot_id=excluded.bot_id,telegram_user_id=excluded.telegram_user_id,chat_id=excluded.chat_id,username=excluded.username,display_name=excluded.display_name,blocked=false,connected_at=now();
 update app_private.telegram_links set consumed_by=p_telegram where token_hash=p_hash;
 insert into app_private.notification_subscriptions(workspace_id,user_id) values(link.workspace_id,link.user_id)
 on conflict(workspace_id,user_id,channel,event) do update set enabled=true;
 return true;
end;$$;

create function public.set_notification_subscription(p_workspace uuid,p_bot bigint,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not app_private.has_role(p_workspace) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_enabled is null or (p_enabled and not exists(select 1 from app_private.telegram_connections where user_id=auth.uid() and bot_id=p_bot and not blocked)) then raise exception 'Connect Telegram' using errcode='22023';end if;
 insert into app_private.notification_subscriptions(workspace_id,user_id,enabled) values(p_workspace,auth.uid(),p_enabled)
 on conflict(workspace_id,user_id,channel,event) do update set enabled=excluded.enabled;
end;$$;

create function public.disconnect_telegram() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 delete from app_private.telegram_connections where user_id=auth.uid();
 delete from app_private.telegram_links where user_id=auth.uid();
 update app_private.notification_subscriptions set enabled=false where user_id=auth.uid() and channel='telegram';
 update app_private.notification_deliveries set approval_allowed=false where user_id=auth.uid();
end;$$;

create function public.test_telegram_notification(p_workspace uuid,p_bot bigint)
returns void language plpgsql security definer set search_path='' as $$
declare c app_private.telegram_connections;
begin
 if not app_private.has_role(p_workspace) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into c from app_private.telegram_connections where user_id=auth.uid() and bot_id=p_bot and not blocked for update;
 if not found then raise exception 'Connect Telegram' using errcode='22023';end if;
 if exists(select 1 from app_private.notification_deliveries where user_id=auth.uid() and kind='test' and created_at>now()-interval '30 seconds') then raise exception 'Try again shortly' using errcode='PT409';end if;
 insert into app_private.notification_deliveries(workspace_id,user_id,connection_id,bot_id,kind) values(p_workspace,auth.uid(),c.id,p_bot,'test');
end;$$;

-- No historical backlog on connect. Follow-ups and manual redraft updates do not create new pings.
create function app_private.notify_draft_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.revision is distinct from old.revision or new.status is distinct from old.status then
   update app_private.notification_deliveries set refresh_requested=true,available_at=now() where draft_id=new.id and message_id is not null;
  end if;
  return new;
 end if;
 if new.status not in ('ready','needs_input') or new.follow_up_number is not null then return new;end if;
 insert into app_private.notification_deliveries(workspace_id,user_id,connection_id,bot_id,draft_id,draft_revision,source_revision,draft_body,missing_knowledge,inbound_body,kind)
 select new.workspace_id,s.user_id,c.id,c.bot_id,new.id,new.revision,new.source_revision,new.body,new.missing_knowledge,
  coalesce((select left(body,500) from public.messages where workspace_id=new.workspace_id and conversation_id=new.conversation_id and direction='inbound' order by occurred_at desc,id desc limit 1),''),'draft'
 from app_private.notification_subscriptions s join app_private.telegram_connections c on c.user_id=s.user_id and not c.blocked
 where s.workspace_id=new.workspace_id and s.enabled and s.channel='telegram' and s.event='draft_ready'
 on conflict(user_id,draft_id,draft_revision) do nothing;
 return new;
end;$$;
revoke all on function app_private.notify_draft_change() from public,anon,authenticated,service_role;
create trigger draft_notification after insert or update on public.drafts for each row execute function app_private.notify_draft_change();

create function public.server_claim_notification(p_bot bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare n app_private.notification_deliveries; c app_private.telegram_connections; d public.drafts; convo public.conversations; member_role text; draft_status text; token uuid;
begin
 select * into n from app_private.notification_deliveries where bot_id=p_bot and available_at<=now()
 and ((status in ('pending','sending') and (lease_until is null or lease_until<now())) or (status='sent' and refresh_requested and (lease_until is null or lease_until<now())))
 order by available_at,id for update skip locked limit 1;
 if not found then return null;end if;
 select * into c from app_private.telegram_connections where user_id=n.user_id and id=n.connection_id and bot_id=p_bot and not blocked;
 select role into member_role from public.workspace_members where workspace_id=n.workspace_id and user_id=n.user_id;
 if c.id is null or member_role is null or (n.status<>'sent' and n.kind='draft' and not exists(select 1 from app_private.notification_subscriptions where workspace_id=n.workspace_id and user_id=n.user_id and channel='telegram' and enabled)) then
  update app_private.notification_deliveries set status='skipped',refresh_requested=false,approval_allowed=false where id=n.id;
  return jsonb_build_object('skipped',true);
 end if;
 if n.kind='draft' then
  select * into d from public.drafts where id=n.draft_id and workspace_id=n.workspace_id;
  select * into convo from public.conversations where id=d.conversation_id and workspace_id=n.workspace_id;
  draft_status=case when d.status='sent' then 'sent' when d.revision is distinct from n.draft_revision or d.source_revision is distinct from convo.inbound_revision or d.status not in ('ready','needs_input') then 'changed' else d.status end;
  if n.status<>'sent' and draft_status in ('sent','changed') then
   update app_private.notification_deliveries set status='skipped',approval_allowed=false where id=n.id;
   return jsonb_build_object('skipped',true);
  end if;
 end if;
 token=gen_random_uuid();
 update app_private.notification_deliveries set status=case when n.status='sent' then 'sent' else 'sending' end,lease_token=token,lease_until=now()+interval '1 minute',attempts=attempts+1,refresh_requested=false where id=n.id;
 return jsonb_build_object('skipped',false,'id',n.id,'leaseToken',token,'kind',n.kind,'chatId',c.chat_id,'messageId',n.message_id,'workspaceId',n.workspace_id,
  'workspaceName',(select name from public.workspaces where id=n.workspace_id),'conversationId',d.conversation_id,'contactName',convo.contact_name,'senderName',convo.sender_name,
  'inboundBody',n.inbound_body,
  'draftBody',n.draft_body,'missingKnowledge',n.missing_knowledge,'status',draft_status,'canApprove',member_role in ('owner','admin','member') and draft_status='ready');
end;$$;

create function public.server_prepare_notification(p_id uuid,p_lease uuid,p_text text,p_approve boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if length(p_text)>4096 then raise exception 'Message too long' using errcode='22023';end if;
 update app_private.notification_deliveries n set rendered_text=p_text,approval_allowed=p_approve
 where n.id=p_id and n.lease_token=p_lease and n.lease_until>now()
 and exists(select 1 from app_private.telegram_connections c where c.id=n.connection_id and c.user_id=n.user_id and not c.blocked)
 and exists(select 1 from public.workspace_members m where m.workspace_id=n.workspace_id and m.user_id=n.user_id)
 and (n.kind='test' or n.status='sent' or exists(select 1 from app_private.notification_subscriptions s where s.workspace_id=n.workspace_id and s.user_id=n.user_id and s.channel='telegram' and s.enabled));
 return found;
end;$$;

create function public.server_finish_notification(p_id uuid,p_lease uuid,p_message bigint default null,p_error text default null,p_retry integer default 30)
returns void language plpgsql security definer set search_path='' as $$
declare n app_private.notification_deliveries;
begin
 select * into n from app_private.notification_deliveries where id=p_id and lease_token=p_lease for update;
 if not found then return;end if;
 if p_error='blocked' then update app_private.telegram_connections set blocked=true where id=n.connection_id;end if;
 update app_private.notification_deliveries set
 status=case when p_error is null then 'sent' when n.attempts>=5 or p_error='blocked' then 'failed' when n.message_id is not null then 'sent' else 'pending' end,
 message_id=coalesce(p_message,message_id),error_code=p_error,lease_until=null,lease_token=null,
 attempts=case when p_error is null then 0 else attempts end,
 refresh_requested=refresh_requested
  or (p_error is null and n.message_id is null and n.kind='draft' and exists(select 1 from public.drafts d join public.conversations c on c.workspace_id=d.workspace_id and c.id=d.conversation_id where d.id=n.draft_id and (d.revision<>n.draft_revision or d.status not in ('ready','needs_input') or d.source_revision<>c.inbound_revision)))
  or (p_error is not null and n.message_id is not null and n.attempts<5 and p_error<>'blocked'),
 available_at=case when p_error is null then now() else now()+make_interval(secs=>greatest(2,least(coalesce(p_retry,30),3600))) end
 where id=n.id;
end;$$;

-- Both entry points share the same transaction. The public UI wrapper obtains the actor from auth.uid().
create function app_private.reserve_send_as(p_actor uuid,p_workspace uuid,p_id uuid,p_conversation uuid,p_body text,p_draft uuid,p_revision integer,p_source_revision integer,p_connection_revision integer)
returns jsonb language plpgsql set search_path='' as $$
declare c public.conversations; d public.drafts; op public.send_operations; payload jsonb;
begin
 perform 1 from public.workspaces where id=p_workspace for update;
 if p_actor is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin','member')) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 8000 then raise exception 'Invalid message' using errcode='22023';end if;
 payload=jsonb_build_object('conversationId',p_conversation,'body',btrim(p_body),'draftId',p_draft,'revision',p_revision,'sourceRevision',p_source_revision);
 select * into c from public.conversations where workspace_id=p_workspace and id=p_conversation for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 select * into op from public.send_operations where workspace_id=p_workspace and id=p_id;
 if found then
  if op.user_id<>p_actor or op.request<>payload then raise exception 'Request already used' using errcode='PT409';end if;
  return jsonb_build_object('kind','existing','status',op.status,'reason',op.reason);
 end if;
 if not exists(select 1 from public.connections where workspace_id=p_workspace and status='connected' and revision=p_connection_revision) or not exists(select 1 from public.senders where workspace_id=p_workspace and provider_id=c.sender_id and auth_valid) then raise exception 'Connect the conversation sender' using errcode='22023';end if;
 if p_draft is not null then
  select * into d from public.drafts where workspace_id=p_workspace and id=p_draft and conversation_id=p_conversation for update;
  if not found or d.status<>'ready' or d.revision is distinct from p_revision or d.source_revision is distinct from p_source_revision or c.inbound_revision<>d.source_revision then raise exception 'Draft context changed' using errcode='PT409';end if;
 end if;
 if exists(select 1 from public.send_operations where workspace_id=p_workspace and conversation_id=p_conversation and status in ('sending','unknown')) then raise exception 'A previous send needs its status checked' using errcode='PT409';end if;
 insert into public.send_operations(workspace_id,id,user_id,conversation_id,request,status,source_revision) values(p_workspace,p_id,p_actor,p_conversation,payload,'sending',c.inbound_revision);
 insert into app_private.jobs(workspace_id,kind,dedup_key,payload,available_at) values(p_workspace,'reconcile_send',p_id::text,jsonb_build_object('operationId',p_id),now()+interval '90 seconds');
 return jsonb_build_object('kind','reserved','senderId',c.sender_id,'providerConversationId',c.provider_conversation_id,'body',btrim(p_body));
end;$$;
revoke all on function app_private.reserve_send_as(uuid,uuid,uuid,uuid,text,uuid,integer,integer,integer) from public,anon,authenticated,service_role;
create or replace function public.reserve_send(p_workspace uuid,p_id uuid,p_conversation uuid,p_body text,p_draft uuid default null,p_revision integer default null,p_source_revision integer default null,p_connection_revision integer default null)
returns jsonb language sql security definer set search_path='' as $$
 select app_private.reserve_send_as(auth.uid(),p_workspace,p_id,p_conversation,p_body,p_draft,p_revision,p_source_revision,p_connection_revision);
$$;

create function public.server_telegram_action(p_id uuid,p_bot bigint,p_telegram bigint,p_chat bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n app_private.notification_deliveries; d public.drafts;
begin
 select n1.* into n from app_private.notification_deliveries n1
 join app_private.telegram_connections c on c.id=n1.connection_id and c.user_id=n1.user_id and c.bot_id=p_bot and c.telegram_user_id=p_telegram and c.chat_id=p_chat and not c.blocked
 join public.workspace_members m on m.workspace_id=n1.workspace_id and m.user_id=n1.user_id and m.role in ('owner','admin','member')
 where n1.id=p_id and n1.bot_id=p_bot and n1.kind='draft';
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 select * into d from public.drafts where workspace_id=n.workspace_id and id=n.draft_id;
 return jsonb_build_object('workspaceId',n.workspace_id,'userId',n.user_id,'conversationId',d.conversation_id,'operationId',n.operation_id,'body',n.draft_body,'renderedText',n.rendered_text,'draft',jsonb_build_object('id',n.draft_id,'revision',n.draft_revision,'sourceRevision',n.source_revision));
end;$$;

create function public.server_reserve_telegram_send(p_id uuid,p_bot bigint,p_telegram bigint,p_chat bigint,p_connection_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare info jsonb; n app_private.notification_deliveries; d public.drafts;
begin
 info=public.server_telegram_action(p_id,p_bot,p_telegram,p_chat);
 perform 1 from public.workspaces where id=(info->>'workspaceId')::uuid for update;
 -- Recheck identity and membership after taking the same workspace lock as UI sends.
 info=public.server_telegram_action(p_id,p_bot,p_telegram,p_chat);
 select * into n from app_private.notification_deliveries where id=p_id for update;
 if not exists(select 1 from public.send_operations where id=n.operation_id and workspace_id=n.workspace_id) then
  select * into d from public.drafts where id=n.draft_id and workspace_id=n.workspace_id;
  if not n.approval_allowed or n.message_id is null or d.body is distinct from n.draft_body or d.follow_up_number is not null
   or exists(select 1 from public.conversations where id=d.conversation_id and workspace_id=n.workspace_id and contact_stopped) then raise exception 'Review the draft in the platform' using errcode='PT409';end if;
 end if;
 return app_private.reserve_send_as(n.user_id,n.workspace_id,n.operation_id,(info->>'conversationId')::uuid,n.draft_body,n.draft_id,n.draft_revision,n.source_revision,p_connection_revision);
end;$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in (
 'get_notification_settings','create_telegram_link','set_notification_subscription','disconnect_telegram','test_telegram_notification',
 'server_connect_telegram','server_claim_notification','server_prepare_notification','server_finish_notification','server_telegram_action','server_reserve_telegram_send') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to %I',f.signature,case when f.proname like 'server_%' then 'service_role' else 'authenticated' end);
 end loop;
end;$$;
