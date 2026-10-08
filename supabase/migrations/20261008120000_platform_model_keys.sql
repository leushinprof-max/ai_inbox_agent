-- Platform-wide model provider keys entered in Product admin. The server encrypts
-- each key before storage; browsers only see a short hint of the saved key.
create table app_private.model_credentials(
 provider text primary key check(provider in ('openai','anthropic')),
 ciphertext text not null check(length(ciphertext) between 1 and 20000),
 key_hint text not null check(length(key_hint) between 1 and 8),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table app_private.model_credentials enable row level security;
revoke all on app_private.model_credentials from public,anon,authenticated;

create function public.model_credential_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_platform_owner() then raise exception 'Forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'keyHint',key_hint,'updatedAt',updated_at) order by provider) from app_private.model_credentials),'[]'::jsonb);
end;$$;
revoke all on function public.model_credential_status() from public,anon;
grant execute on function public.model_credential_status() to authenticated;

create function public.server_model_credentials() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(provider,ciphertext),'{}'::jsonb) from app_private.model_credentials;
$$;
create function public.server_set_model_credential(p_provider text,p_actor uuid,p_ciphertext text,p_hint text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from app_private.platform_owners where user_id=p_actor) then raise exception 'Forbidden' using errcode='42501'; end if;
 insert into app_private.model_credentials(provider,ciphertext,key_hint,updated_by) values(p_provider,p_ciphertext,p_hint,p_actor)
  on conflict(provider) do update set ciphertext=excluded.ciphertext,key_hint=excluded.key_hint,updated_by=excluded.updated_by,updated_at=now();
end;$$;
create function public.delete_model_credential(p_provider text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_owner() then raise exception 'Forbidden' using errcode='42501'; end if;
 delete from app_private.model_credentials where provider=p_provider;
end;$$;
revoke all on function public.server_model_credentials(),public.server_set_model_credential(text,uuid,text,text),public.delete_model_credential(text) from public,anon,authenticated;
grant execute on function public.server_model_credentials(),public.server_set_model_credential(text,uuid,text,text) to service_role;
grant execute on function public.delete_model_credential(text) to authenticated;
