import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  initialAIConfiguration,
  serializeConfiguration,
} from "../src/integrations/ai/configuration";
import {
  readAgentBackground,
  writeAgentBackground,
} from "../src/domain/agent-background";
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

test("Reply v2 saves and publishes, completes needs-input and rewrite with exact run links, and never learns operator answers", async () => {
  const owner = randomUUID(),
    member = randomUUID(),
    agent = randomUUID(),
    conversation = randomUUID(),
    message = randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'v2-owner@test.test'),($2,'v2-member@test.test')",
    [owner, member],
  );
  await db.query(
    "insert into app_private.platform_owners(user_id) values($1)",
    [owner],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const workspace = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Reply v2') id",
    )
  ).rows[0].id;
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'member')",
    [workspace, member],
  );
  const config = serializeConfiguration(initialAIConfiguration);
  const version = (
    await db.query<{ id: number }>(
      "select public.save_ai_configuration($1) id",
      [JSON.stringify(config)],
    )
  ).rows[0].id;
  assert.deepEqual(
    (
      await db.query<{ configuration: unknown }>(
        "select configuration from public.ai_config_versions where id=$1",
        [version],
      )
    ).rows[0].configuration,
    config,
  );
  const release = (
    await db.query<{ revision: number }>(
      "select revision from public.ai_config_release",
    )
  ).rows[0];
  await db.query("select public.publish_ai_configuration($1,$2)", [
    version,
    release.revision,
  ]);
  const knowledge = writeAgentBackground({
    ...readAgentBackground("Exact offer and terms."),
    companyName: "ReStaff",
    sellingPoints: ["One approved benefit."],
  });
  await db.query("select public.save_agent($1,$2,0,$3)", [
    workspace,
    agent,
    JSON.stringify({
      name: "Reply v2",
      goal: "Help",
      status: "active",
      language: "Russian",
      replyGroups: ["positive"],
      knowledge,
      customInstructions: "Be concise.",
      meetingInstructions: "",
      resources: [],
    }),
  ]);
  await db.query("select public.set_default_agent($1,$2)", [workspace, agent]);
  const label = (
    await db.query<{ id: string }>(
      "select id from public.workspace_labels where workspace_id=$1 and system_key='interested'",
      [workspace],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision,classified_revision,label_id,label_source,label_state) values($1,$2,'v2',1,'Sender','Lead',1,1,$3,'ai','classified')",
    [conversation, workspace, label],
  );
  await db.query(
    "insert into public.messages(id,workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values($1,$2,$3,'v2','Which times?','inbound','provider',now())",
    [message, workspace, conversation],
  );
  const context = (
    await db.query<{ catalog: number; assignment: number }>(
      "select w.label_revision catalog,c.label_assignment_revision assignment from public.workspaces w join public.conversations c on c.workspace_id=w.id where c.id=$1",
      [conversation],
    )
  ).rows[0];
  const currentDraft = async () =>
    (
      await db.query<{
        id: string;
        revision: number;
        status: string;
        body: string;
        ai_run_id: string | null;
      }>(
        "select id,revision,status,body,ai_run_id from public.drafts where workspace_id=$1 and conversation_id=$2 and status in ('ready','needs_input','snoozed')",
        [workspace, conversation],
      )
    ).rows[0];
  const request = async (answer = "", instructions = "") => {
    const draft = await currentDraft(),
      id = randomUUID();
    await db.query(
      "select public.request_draft_generation($1,$2,$3,1,$4,$5,$6,$7,false)",
      [
        workspace,
        id,
        conversation,
        draft?.id ?? null,
        draft?.revision ?? null,
        instructions,
        answer,
      ],
    );
    return id;
  };
  const complete = async (id: string, body: string, missing: string) => {
    const run = randomUUID(),
      snapshot = {
        input: [{ role: "system", content: "Exact prompt for " + id }],
        model: "test-model",
      };
    await db.query(
      "insert into public.ai_runs(id,workspace_id,conversation_id,configuration_version,catalog_revision,agent_id,agent_version,scenario,model,status,request_snapshot,result_snapshot) values($1,$2,$3,$4,$5,$6,1,'reply','test-model','completed',$7,$8)",
      [
        run,
        workspace,
        conversation,
        version,
        context.catalog,
        agent,
        JSON.stringify(snapshot),
        JSON.stringify({ draft: body, missingKnowledge: missing }),
      ],
    );
    await db.query(
      "select public.server_complete_generation_v3($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        workspace,
        id,
        body,
        missing,
        version,
        context.catalog,
        context.assignment,
        run,
      ],
    );
    assert.equal((await currentDraft()).ai_run_id, run);
    return run;
  };
  const first = await request();
  await complete(first, "", "Which dates are available?");
  assert.equal((await currentDraft()).status, "needs_input");
  const pending = await currentDraft();
  await assert.rejects(
    db.query(
      "select public.request_draft_generation($1,$2,$3,1,$4,$5,'','Keep this forever',true)",
      [workspace, randomUUID(), conversation, pending.id, pending.revision],
    ),
    /Edit permanent information/,
  );
  await assert.rejects(
    db.query(
      "select public.act_on_draft($1,$2,$3,'answer','Keep this forever',null,true)",
      [workspace, pending.id, pending.revision],
    ),
    /Edit permanent information/,
  );
  const second = await request("September 15 at 14:00 London is available.");
  await complete(second, "Does September 15 at 14:00 London work?", "");
  const third = await request("", "Shorten it.");
  const latestRun = await complete(third, "September 15, 14:00 London?", "");
  assert.equal((await currentDraft()).body, "September 15, 14:00 London?");
  assert.deepEqual(
    (
      await db.query(
        "select knowledge,version from public.agents where id=$1",
        [agent],
      )
    ).rows[0],
    { knowledge, version: 1 },
  );
  assert.equal(
    (
      await db.query("select id from public.ai_runs where workspace_id=$1", [
        workspace,
      ])
    ).rows.length,
    3,
    "Rewrites preserve prior run snapshots",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    member,
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select id from public.ai_runs where id=$1", [latestRun]))
      .rows.length,
    0,
    "Workspace membership alone cannot view full requests",
  );
  await assert.rejects(
    db.query("select public.save_ai_configuration($1)", [
      JSON.stringify(config),
    ]),
    /Forbidden/,
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select id from public.ai_runs where id=$1", [latestRun]))
      .rows.length,
    1,
  );
  await db.exec("reset role");
  const stale = await request();
  await db.query(
    "update public.conversations set inbound_revision=2 where id=$1",
    [conversation],
  );
  await db.query(
    "select public.server_complete_generation_v3($1,$2,'Stale answer','',$3,$4,$5,null)",
    [workspace, stale, version, context.catalog, context.assignment],
  );
  assert.equal(
    (await currentDraft()).body,
    "September 15, 14:00 London?",
    "An inbound revision change preserves the reviewed draft",
  );
});
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
