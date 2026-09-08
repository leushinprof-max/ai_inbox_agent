import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(new URL(file, directory), "utf8"));
});
after(() => db.close());
test("Profile and photo refresh preserve message revisions and tolerate older workers", async () => {
  const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await db.query("insert into public.workspaces(id,name) values($1,'Photos')", [
    workspace,
  ]);
  await db.query(
    "insert into public.connections(workspace_id,status,revision) values($1,'connected',1)",
    [workspace],
  );
  await db.query(
    "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,1,'Sender',true)",
    [workspace],
  );
  const base = {
    id: "photo-chat",
    senderId: 1,
    senderName: "Sender",
    contactName: "Lead",
    messages: [],
  };
  for (const photoUrl of [
    "https://media.licdn.com/first",
    undefined,
    "https://media.licdn.com/updated",
  ]) {
    await db.query("select public.server_ingest_conversation($1,1,$2::jsonb)", [
      workspace,
      JSON.stringify({
        ...base,
        photoUrl,
        senderPhotoUrl: photoUrl,
        profileUrl: photoUrl
          ? `https://www.linkedin.com/in/${photoUrl.split("/").at(-1)}/`
          : undefined,
      }),
    ]);
    const row = (
      await db.query<{
        contact_photo_url: string;
        sender_photo_url: string;
        contact_profile_url: string;
        inbound_revision: number;
      }>(
        "select contact_photo_url,sender_photo_url,contact_profile_url,inbound_revision from public.conversations where workspace_id=$1",
        [workspace],
      )
    ).rows[0];
    assert.equal(
      row.contact_photo_url,
      photoUrl ?? "https://media.licdn.com/first",
    );
    assert.equal(row.inbound_revision, 0);
    assert.equal(
      row.contact_profile_url,
      `https://www.linkedin.com/in/${photoUrl?.split("/").at(-1) ?? "first"}/`,
    );
    assert.equal(
      row.sender_photo_url,
      photoUrl ?? "https://media.licdn.com/first",
    );
  }
});
test("Every standalone migration replays from an empty database; all exposed tables have RLS", async () => {
  const tables = (
    await db.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename,rowsecurity from pg_tables where schemaname='public'",
    )
  ).rows;
  assert.ok(tables.length >= 12);
  assert.ok(tables.every((t) => t.rowsecurity));
});
test("The full schema grants neither anonymous data access nor privileged server RPC execution", async () => {
  const serverFunctions = (
    await db.query<{ name: string; oid: number }>(
      "select proname name,p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'server_%'",
    )
  ).rows;
  assert.ok(serverFunctions.length >= 10);
  for (const f of serverFunctions) {
    const access = (
      await db.query<{
        anonymous: boolean;
        authenticated: boolean;
        worker: boolean;
      }>(
        "select has_function_privilege('anon',$1,'EXECUTE') anonymous,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') worker",
        [f.oid],
      )
    ).rows[0];
    assert.deepEqual(
      access,
      { anonymous: false, authenticated: false, worker: true },
      f.name,
    );
  }
  const privateTables = (
    await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='app_private'",
    )
  ).rows;
  for (const t of privateTables) {
    assert.equal(
      (
        await db.query<{ allowed: boolean }>(
          "select has_table_privilege('authenticated',$1,'SELECT') allowed",
          [`app_private.${t.tablename}`],
        )
      ).rows[0].allowed,
      false,
      t.tablename,
    );
  }
});
