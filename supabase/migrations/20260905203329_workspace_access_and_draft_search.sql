create function public.draft_page(p_workspace uuid,p_status text default null,p_query text default '',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 51)
returns setof public.drafts language plpgsql stable security definer set search_path='' as $$
declare search text;
begin
  if not app_private.has_role(p_workspace) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('ready','needs_input','snoozed') then raise exception 'Invalid queue' using errcode='22023'; end if;
  search=replace(replace(replace(left(coalesce(p_query,''),200),'\','\\'),'%','\%'),'_','\_');
  return query select d.* from public.drafts d join public.conversations c on c.workspace_id=d.workspace_id and c.id=d.conversation_id
    where d.workspace_id=p_workspace and d.status in ('ready','needs_input','snoozed') and (p_status is null or d.status=p_status)
    and (search='' or c.contact_name ilike '%'||search||'%' or c.contact_company ilike '%'||search||'%')
    and (p_before is null or (d.created_at,d.id)<(p_before,p_before_id))
    order by d.created_at desc,d.id desc limit least(greatest(p_limit,1),101);
end;
$$;
revoke all on function public.draft_page(uuid,text,text,timestamptz,uuid,integer) from public,anon;
grant execute on function public.draft_page(uuid,text,text,timestamptz,uuid,integer) to authenticated;

create table app_private.workspace_invitations (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
  email text not null check(length(email) between 3 and 254),role text not null check(role in ('admin','member','viewer')),
  token_hash text not null unique,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',accepted_at timestamptz,revoked_at timestamptz
);
alter table app_private.workspace_invitations enable row level security;
revoke all on app_private.workspace_invitations from public,anon,authenticated;
grant select,insert,update on app_private.workspace_invitations to service_role;

create function public.create_workspace_invite(p_workspace uuid,p_email text,p_role text,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invite_id uuid;
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_role not in ('admin','member','viewer') or p_hash !~ '^[a-f0-9]{64}$' or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  if (select count(*) from app_private.workspace_invitations where workspace_id=p_workspace and created_at>now()-interval '1 hour')>=30 then raise exception 'Invitation limit reached' using errcode='22023'; end if;
  update app_private.workspace_invitations set revoked_at=now() where workspace_id=p_workspace and email=lower(btrim(p_email)) and accepted_at is null and revoked_at is null;
  insert into app_private.workspace_invitations(workspace_id,email,role,token_hash,created_by) values(p_workspace,lower(btrim(p_email)),p_role,p_hash,auth.uid()) returning id into invite_id;
  return invite_id;
end;
$$;
revoke all on function public.create_workspace_invite(uuid,text,text,text) from public,anon;
grant execute on function public.create_workspace_invite(uuid,text,text,text) to authenticated;

create function public.list_workspace_invites(p_workspace uuid) returns table(id uuid,email text,role text,expires_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  return query select i.id,i.email,i.role,i.expires_at from app_private.workspace_invitations i where i.workspace_id=p_workspace and i.accepted_at is null and i.revoked_at is null and i.expires_at>now() order by i.created_at desc limit 100;
end;
$$;
revoke all on function public.list_workspace_invites(uuid) from public,anon;
grant execute on function public.list_workspace_invites(uuid) to authenticated;

create function public.revoke_workspace_invite(p_workspace uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  update app_private.workspace_invitations set revoked_at=now() where workspace_id=p_workspace and id=p_id and accepted_at is null;
end;
$$;
revoke all on function public.revoke_workspace_invite(uuid,uuid) from public,anon;
grant execute on function public.revoke_workspace_invite(uuid,uuid) to authenticated;

create function public.accept_workspace_invite(p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare invitation app_private.workspace_invitations; verified_email text;
begin
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Verify your email before joining' using errcode='42501'; end if;
  select * into invitation from app_private.workspace_invitations where token_hash=p_hash;
  if not found then raise exception 'Invitation unavailable' using errcode='22023'; end if;
  perform 1 from public.workspaces where id=invitation.workspace_id for update;
  select * into invitation from app_private.workspace_invitations where token_hash=p_hash for update;
  if invitation.email<>verified_email or invitation.expires_at<=now() or invitation.accepted_at is not null or invitation.revoked_at is not null then raise exception 'Invitation unavailable for this account' using errcode='42501'; end if;
  insert into public.workspace_members(workspace_id,user_id,role) values(invitation.workspace_id,auth.uid(),invitation.role) on conflict do nothing;
  update app_private.workspace_invitations set accepted_at=now() where id=invitation.id;
  return invitation.workspace_id;
end;
$$;
revoke all on function public.accept_workspace_invite(text) from public,anon;
grant execute on function public.accept_workspace_invite(text) to authenticated;

create function public.change_workspace_member(p_workspace uuid,p_user uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare actor text; target text;
begin
  perform 1 from public.workspaces where id=p_workspace for update;
  select role into actor from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid();
  select role into target from public.workspace_members where workspace_id=p_workspace and user_id=p_user;
  if actor is null or actor not in ('owner','admin') or target is null or p_user=auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if (target='owner' or p_role='owner') and actor<>'owner' then raise exception 'Only owners can manage ownership' using errcode='42501'; end if;
  if p_role is not null and p_role not in ('owner','admin','member','viewer') then raise exception 'Invalid role' using errcode='22023'; end if;
  if target='owner' and p_role is distinct from 'owner' and (select count(*) from public.workspace_members where workspace_id=p_workspace and role='owner')<=1 then raise exception 'Keep a workspace owner' using errcode='22023'; end if;
  if p_role is null then delete from public.workspace_members where workspace_id=p_workspace and user_id=p_user;
  else update public.workspace_members set role=p_role where workspace_id=p_workspace and user_id=p_user; end if;
end;
$$;
revoke all on function public.change_workspace_member(uuid,uuid,text) from public,anon;
grant execute on function public.change_workspace_member(uuid,uuid,text) to authenticated;

create table app_private.model_test_requests(workspace_id uuid not null references public.workspaces(id),created_at timestamptz not null default now());
create index model_test_workspace_time_idx on app_private.model_test_requests(workspace_id,created_at);
alter table app_private.model_test_requests enable row level security;
revoke all on app_private.model_test_requests from public,anon,authenticated;
create function public.reserve_agent_test(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not app_private.has_role(p_workspace,array['owner','admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace for update;
  delete from app_private.model_test_requests where workspace_id=p_workspace and created_at<now()-interval '1 hour';
  if (select count(*) from app_private.model_test_requests where workspace_id=p_workspace)>=30 then raise exception 'Test limit reached. Try again later' using errcode='22023'; end if;
  insert into app_private.model_test_requests(workspace_id) values(p_workspace);
end;
$$;
revoke all on function public.reserve_agent_test(uuid) from public,anon;
grant execute on function public.reserve_agent_test(uuid) to authenticated;
