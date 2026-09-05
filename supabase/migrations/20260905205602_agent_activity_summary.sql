create index draft_agent_sent_idx on public.drafts(workspace_id,agent_id) where status='sent';
create function public.agent_activity(p_workspace uuid) returns table(agent_id uuid,sent bigint)
language sql stable security invoker set search_path='' as $$
  select d.agent_id,count(*) from public.drafts d where d.workspace_id=p_workspace and d.status='sent' group by d.agent_id;
$$;
revoke all on function public.agent_activity(uuid) from public,anon;
grant execute on function public.agent_activity(uuid) to authenticated;
