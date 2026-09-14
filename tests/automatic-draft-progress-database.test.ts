import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(new URL(file, directory), "utf8"));
});
after(() => db.close());

async function fixture() {
  const owner = randomUUID(),
    conversation = randomUUID(),
    agent = randomUUID(),
    job = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    owner,
    `${owner}@example.test`,
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const workspace = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Draft progress fixture') id",
    )
  ).rows[0].id;
  await db.query("select public.save_agent($1,$2,0,$3)", [
    workspace,
    agent,
    JSON.stringify({
      name: "Agent",
      status: "active",
      goal: "Help leads",
      knowledge: "Approved facts",
      replyGroups: ["positive"],
    }),
  ]);
  await db.query(
    "update public.workspaces set default_agent_id=$2 where id=$1",
    [workspace, agent],
  );
  await db.query(
    "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,1,'Alex',true)",
    [workspace],
  );
  await db.query(
    "insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision) values($1,$2,$1::uuid::text,1,'Alex','Jane',1)",
    [conversation, workspace],
  );
  await db.query(
    "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values($1,$2,'inbound','Tell me more','inbound','provider',now())",
    [workspace, conversation],
  );
  await db.query(
    "insert into app_private.jobs(id,workspace_id,kind,dedup_key,payload) values($1,$2,'classify',$1::uuid::text,$3)",
    [
      job,
      workspace,
      JSON.stringify({
        conversationId: conversation,
        revision: 1,
        generateDraft: true,
      }),
    ],
  );
  const progress = async () =>
    (
      await db.query<{
        status: string;
        draft_id: string | null;
        result_revision: number;
        error_code: string | null;
      }>("select * from public.automatic_draft_progress($1)", [workspace])
    ).rows;
  return { owner, workspace, conversation, agent, job, progress };
}

test("Automatic jobs expose pending, ready and no-reply progress without exposing job payloads", async () => {
  const f = await fixture();
  assert.equal((await f.progress())[0].status, "queued");
  await db.query("update app_private.jobs set status='running' where id=$1", [
    f.job,
  ]);
  assert.equal((await f.progress())[0].status, "queued");
  const draft = randomUUID();
  await db.query(
    "insert into public.drafts(id,workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision) values($1,$2,$3,$4,1,'Hello Jane','ready',1)",
    [draft, f.workspace, f.conversation, f.agent],
  );
  await db.query("update app_private.jobs set status='done' where id=$1", [
    f.job,
  ]);
  const ready = (await f.progress())[0];
  assert.equal(ready.status, "completed");
  assert.equal(ready.draft_id, draft);
  assert.equal(ready.result_revision, 1);
  assert.equal("payload" in ready, false);
  await db.query("update public.drafts set status='dismissed' where id=$1", [
    draft,
  ]);
  assert.equal((await f.progress())[0].error_code, "no_reply_needed");
});

test("Stale replies and classify-only imports are excluded; disabled agents and failures stop loading", async () => {
  const f = await fixture();
  await db.query(
    "update app_private.jobs set payload=payload||'{\"generateDraft\":false}'::jsonb where id=$1",
    [f.job],
  );
  assert.equal((await f.progress()).length, 0);
  await db.query(
    'update app_private.jobs set payload=payload||\'{"generateDraft":true,"revision":0}\'::jsonb where id=$1',
    [f.job],
  );
  assert.equal((await f.progress()).length, 0);
  await db.query(
    "update app_private.jobs set payload=payload||'{\"revision\":1}'::jsonb where id=$1",
    [f.job],
  );
  await db.query(
    "update public.conversations set agent_enabled=false where id=$1",
    [f.conversation],
  );
  assert.equal((await f.progress())[0].status, "cancelled");
  await db.query(
    "update public.conversations set agent_enabled=true where id=$1",
    [f.conversation],
  );
  await db.query(
    "update app_private.jobs set status='failed',error_code='model_timeout' where id=$1",
    [f.job],
  );
  assert.equal((await f.progress())[0].status, "failed");
});

test("Progress is visible to workspace viewers but neither outsiders nor anonymous clients can read it", async () => {
  const f = await fixture();
  const viewer = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    viewer,
    `${viewer}@example.test`,
  ]);
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
    [f.workspace, viewer],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer,
  ]);
  await db.exec("set role authenticated");
  try {
    assert.equal((await f.progress()).length, 1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      randomUUID(),
    ]);
    await assert.rejects(f.progress, /Forbidden/);
  } finally {
    await db.exec("reset role");
  }
  await db.exec("set role anon");
  try {
    await assert.rejects(f.progress, /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});
