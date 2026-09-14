-- Names describe saved versions without changing their prompts or publication.
alter table public.ai_config_versions add column name text
  check (name is null or (name = btrim(name) and char_length(name) between 1 and 120));

create function public.name_ai_configuration(p_version bigint, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare version_name text := nullif(btrim(p_name), '');
begin
  if not public.is_platform_owner() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if char_length(version_name) > 120 then
    raise exception 'Version name must be at most 120 characters' using errcode = '22023';
  end if;
  update public.ai_config_versions set name = version_name where id = p_version;
  if not found then
    raise exception 'Configuration version not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.name_ai_configuration(bigint,text) from public,anon;
grant execute on function public.name_ai_configuration(bigint,text) to authenticated;
