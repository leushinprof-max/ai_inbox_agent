import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const db = new PGlite();
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create schema auth;
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
test("Agent guidance survives versioning and legacy saves; sender form updates enforce access and conflicts", async () => {
  const owner = randomUUID(),
    member = randomUUID(),
    outsider = randomUUID(),
    agent = randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'guidance-owner@test.test'),($2,'guidance-member@test.test'),($3,'guidance-outsider@test.test')",
    [owner, member, outsider],
  );
  const asUser = (id: string) =>
    db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await asUser(owner);
  const workspace = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Guidance') id",
    )
  ).rows[0].id;
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'member')",
    [workspace, member],
  );
  const resource = {
    kind: "link",
    id: randomUUID(),
    name: "Deck",
    url: "https://example.test/deck",
    whenToUse: "When requested",
  };
  const config = {
    name: "ReStaff",
    goal: "Book a call",
    language: "Russian",
    knowledge: "Approved facts",
    status: "active",
    replyGroups: ["positive", "neutral"],
    customInstructions: "Explain the offer before suggesting a call.",
    meetingInstructions: "Ask the operator for slots.",
    resources: [resource],
  };
  const save = (revision: number, value: unknown) =>
    db.query("select public.save_agent($1,$2,$3,$4)", [
      workspace,
      agent,
      revision,
      JSON.stringify(value),
    ]);
  await save(0, config);
  const current = async () =>
    (
      await db.query<{
        version: number;
        custom_instructions: string;
        resources: unknown;
      }>(
        "select version,custom_instructions,resources from public.agents where id=$1",
        [agent],
      )
    ).rows[0];
  const snapshot = async () =>
    (
      await db.query<{ configuration: typeof config }>(
        "select configuration from public.agent_versions where agent_id=$1 order by version desc limit 1",
        [agent],
      )
    ).rows[0].configuration;
  assert.equal(
    (await snapshot()).customInstructions,
    config.customInstructions,
  );
  const legacy = {
    name: config.name,
    goal: config.goal,
    language: config.language,
    knowledge: config.knowledge,
    status: config.status,
    replyGroups: config.replyGroups,
  };
  await save((await current()).version, legacy);
  assert.deepEqual((await snapshot()).resources, [resource]);
  await assert.rejects(
    save((await current()).version, {
      ...config,
      resources: [{ ...resource, url: "javascript:alert(1)" }],
    }),
    /Invalid resources/,
  );
  await db.query(
    "insert into public.senders(workspace_id,provider_id,name,auth_valid,agent_id) values($1,99,'Natalya',true,$2)",
    [workspace, agent],
  );
  const setForm = (form: string, expected: string) =>
    db.query("select public.save_sender_voice($1,99,$2,$3)", [
      workspace,
      form,
      expected,
    ]);
  for (const id of [member, outsider]) {
    await asUser(id);
    await assert.rejects(setForm("feminine", "unspecified"), /Forbidden/);
  }
  await asUser(owner);
  const oldVersion = (await current()).version;
  await setForm("feminine", "unspecified");
  assert.equal((await current()).version, oldVersion + 1);
  assert.equal(
    (await snapshot()).customInstructions,
    config.customInstructions,
  );
  assert.deepEqual((await snapshot()).resources, [resource]);
  await assert.rejects(setForm("masculine", "unspecified"), /Sender changed/);
  await db.query(
    "update public.connections set status='connected',revision=1 where workspace_id=$1",
    [workspace],
  );
  await db.query("select public.server_refresh_senders($1,1,$2)", [
    workspace,
    JSON.stringify([{ id: 99, name: "Natalya updated", authValid: true }]),
  ]);
  assert.equal(
    (
      await db.query<{ grammatical_form: string }>(
        "select grammatical_form from public.senders where workspace_id=$1 and provider_id=99",
        [workspace],
      )
    ).rows[0].grammatical_form,
    "feminine",
  );
  await asUser("");
});
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
