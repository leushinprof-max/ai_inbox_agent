-- Preserve publication/version history and support both prompt formats during rollout.
create or replace function public.save_ai_configuration(p_configuration jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 if not public.is_platform_owner() then raise exception 'Forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_configuration)<>'object' or octet_length(p_configuration::text)>150000 then
  raise exception 'Invalid configuration' using errcode='22023';
 end if;
 if p_configuration->'schemaVersion'='2'::jsonb then
  if not(p_configuration ?& array['classification','reply','labels','defaults','models','reasoning'])
   or p_configuration ?| array['replyDecision','draft','rewrite','needsInput','agentTemplate']
   or jsonb_typeof(p_configuration->'reply')<>'string'
   or nullif(btrim(p_configuration->>'reply'),'') is null then
   raise exception 'Invalid reply agent configuration' using errcode='22023';
  end if;
 elsif p_configuration ? 'schemaVersion' or not(p_configuration ?& array['classification','replyDecision','draft','rewrite','needsInput','agentTemplate','labels','defaults']) then
  raise exception 'Invalid configuration' using errcode='22023';
 end if;
 insert into public.ai_config_versions(configuration,created_by) values(p_configuration,auth.uid()) returning id into v;
 return v;
end;$$;
