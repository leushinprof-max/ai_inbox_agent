-- Description is optional approved text. Old resource JSON and snapshots stay intact.
create or replace function app_private.valid_agent_resources(items jsonb,workspace uuid) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>20 then return false;end if;
 for item in select * from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object'
   or coalesce(item->>'kind','') not in ('link','pdf')
   or coalesce(item->>'id','') !~ '^[a-f0-9-]{36}$'
   or length(btrim(coalesce(item->>'name',''))) not between 1 and 200
   or length(btrim(coalesce(item->>'whenToUse',''))) not between 1 and 2000
   or length(coalesce(item->>'url',''))>2000
   or coalesce(item->>'url','') !~ '^https?://[^[:space:]]+$'
   then return false; end if;
  if item ? 'description' and (
   jsonb_typeof(item->'description') is distinct from 'string'
   or length(item->>'description')>2000
  ) then return false;end if;
  if item->>'kind'='pdf' and (
   coalesce(item->>'storagePath','') !~ ('^'||workspace::text||'/[a-f0-9-]{36}/presentation[.]pdf$')
   or length(coalesce(item->>'fileName','')) not between 1 and 200
  ) then return false;end if;
 end loop;
 return true;
end;
$$;
revoke all on function app_private.valid_agent_resources(jsonb,uuid) from public,anon,authenticated;
