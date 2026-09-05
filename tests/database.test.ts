import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const viewer = "10000000-0000-4000-8000-000000000003";
const agent = "20000000-0000-4000-8000-000000000001";
const conversation = "30000000-0000-4000-8000-000000000001";
const draft = "40000000-0000-4000-8000-000000000001";
let wa: string;
let wb: string;

async function asUser(id: string) {
  await db.exec("reset role; set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;
    insert into auth.users values ('${a}'),('${b}'),('${viewer}');`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20260905193243_standalone_inbox_foundation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await asUser(a);
  wa = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Team A','UTC') as id",
    )
  ).rows[0].id;
  await asUser(b);
  wb = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Team B','UTC') as id",
    )
  ).rows[0].id;
  await db.exec("reset role;");
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values ($1,$2,$3)",
    [wa, viewer, "viewer"],
  );
  await db.query(
    "insert into public.agents(id,workspace_id,name) values ($1,$2,'Agent A')",
    [agent, wa],
  );
  await db.query(
    "insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name) values ($1,$2,'provider-chat',1,'Sender','Lead')",
    [conversation, wa],
  );
  await db.query(
    "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values ($1,$2,'event-1','Hello','inbound','provider',now())",
    [wa, conversation],
  );
  await db.query(
    "insert into public.drafts(id,workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision) values ($1,$2,$3,$4,1,'Reviewed reply','ready',0)",
    [draft, wa, conversation, agent],
  );
});
after(async () => {
  await db.close();
});

test("Database workspace creation atomically creates an owner and disconnected connection", async () => {
  await asUser(a);
  assert.deepEqual(
    (
      await db.query<{ role: string }>(
        "select role from public.workspace_members where user_id = $1",
        [a],
      )
    ).rows,
    [{ role: "owner" }],
  );
  assert.deepEqual(
    (
      await db.query<{ status: string }>(
        "select status from public.connections",
      )
    ).rows,
    [{ status: "disconnected" }],
  );
  assert.equal(
    (await db.query("select * from public.workspaces")).rows.length,
    1,
  );
  await assert.rejects(
    db.query("select public.create_workspace('','UTC')"),
    /Invalid workspace name/,
  );
  await assert.rejects(
    db.query("select public.create_workspace('Test','not-a-timezone')"),
    /Invalid timezone/,
  );
});

test("Database RLS isolates every exposed table across two workspaces", async () => {
  await asUser(b);
  assert.deepEqual(
    (await db.query<{ name: string }>("select name from public.workspaces"))
      .rows,
    [{ name: "Team B" }],
  );
  for (const table of ["agents", "conversations", "messages", "drafts"])
    assert.equal(
      (await db.query(`select * from public.${table}`)).rows.length,
      0,
      table,
    );
  assert.equal(
    (await db.query("select * from public.workspace_members")).rows.length,
    1,
  );
  await assert.rejects(
    db.query("insert into public.agents(workspace_id,name) values ($1,$2)", [
      wa,
      "Intrusion",
    ]),
    /row-level security/,
  );
  await assert.rejects(
    db.query("select public.update_draft($1,$2,1,$3,$4)", [
      wa,
      draft,
      "Intrusion",
      "ready",
    ]),
    /Forbidden/,
  );
  await assert.rejects(
    db.query("update public.workspace_members set role = 'owner'"),
    /permission denied/,
  );
});

test("Database viewers can read but cannot mutate workspace data or drafts", async () => {
  await asUser(viewer);
  assert.equal((await db.query("select * from public.drafts")).rows.length, 1);
  assert.equal(
    (
      await db.query(
        "update public.workspaces set name = 'Changed' returning id",
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query("update public.agents set name = 'Changed' returning id"))
      .rows.length,
    0,
  );
  await assert.rejects(
    db.query("select public.update_draft($1,$2,1,$3,$4)", [
      wa,
      draft,
      "Changed",
      "ready",
    ]),
    /Forbidden/,
  );
});

test("Database anonymous roles cannot read or invoke privileged workspace functions", async () => {
  await db.exec("reset role; set role anon;");
  for (const table of [
    "workspaces",
    "workspace_members",
    "agents",
    "connections",
    "conversations",
    "messages",
    "drafts",
  ])
    await assert.rejects(
      db.query(`select * from public.${table}`),
      /permission denied/,
      table,
    );
  await assert.rejects(
    db.query("select public.create_workspace('Unauthorized','UTC')"),
    /permission denied/,
  );
  await db.exec("reset role; set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await assert.rejects(
    db.query("select public.create_workspace('No user','UTC')"),
    /Authentication required/,
  );
});

test("Database child foreign keys reject cross-workspace conversation references", async () => {
  await db.exec("reset role;");
  await assert.rejects(
    db.query(
      "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values ($1,$2,'leak','bad','inbound','provider',now())",
      [wb, conversation],
    ),
    /foreign key constraint/,
  );
  await assert.rejects(
    db.query(
      "insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision) values ($1,$2,$3,1,'bad','ready',0)",
      [wb, conversation, agent],
    ),
    /foreign key constraint/,
  );
});

test("Database draft mutations require the expected revision and cannot mark messages sent", async () => {
  await asUser(a);
  assert.equal(
    (
      await db.query<{ revision: number }>(
        "select public.update_draft($1,$2,1,$3,$4) as revision",
        [wa, draft, "Updated reply", "ready"],
      )
    ).rows[0].revision,
    2,
  );
  await assert.rejects(
    db.query("select public.update_draft($1,$2,1,$3,$4)", [
      wa,
      draft,
      "Stale overwrite",
      "ready",
    ]),
    /Draft changed/,
  );
  await assert.rejects(
    db.query("select public.update_draft($1,$2,2,$3,$4)", [
      wa,
      draft,
      "Fake acknowledgement",
      "sent",
    ]),
    /Invalid draft action/,
  );
  await assert.rejects(
    db.query("update public.drafts set status = 'sent' where id = $1", [draft]),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values ($1,$2,'fake-send','bad','outbound','accepted_send',now())",
      [wa, conversation],
    ),
    /permission denied/,
  );
});
