import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const user = randomUUID();
const outsider = randomUUID();
let workspace: string, oldRun: string, outreachId: string, repliedId: string;
const outbound = {
  key: "outbound",
  direction: "outbound",
  body: "Our question?",
  occurredAt: "2026-09-05T09:00:00Z",
};
const inbound = {
  key: "inbound",
  direction: "inbound",
  body: "Please tell me more.",
  occurredAt: "2026-08-01T09:00:00Z",
};
const chat = (id: string, messages: object[]) => ({
  id,
  senderId: 42,
  senderName: "Team sender",
  contactName: id,
  company: "Reply eligibility",
  messages,
});
async function ingest(
  id: string,
  messages: object[],
  run: string | null = null,
) {
  return (
    await db.query<{ result: { conversationId: string; revision: number } }>(
      "select public.server_ingest_conversation($1,1,$2::jsonb,$3) result",
      [workspace, JSON.stringify(chat(id, messages)), run],
    )
  ).rows[0].result;
}
async function importPage(ids: string[]) {
  const run = (
    await db.query<{ id: string }>(
      "select public.start_history_import($1,7) id",
      [workspace],
    )
  ).rows[0].id;
  await db.query("select public.server_import_page($1,0,$2,$2,$3::jsonb,1)", [
    run,
    ids.length,
    JSON.stringify(ids.map((id) => ({ id, senderId: 42 }))),
  ]);
  return run;
}
async function classify(
  id: string,
  revision: number,
  run: string | null = null,
) {
  return (
    await db.query<{ applied: boolean }>(
      "select public.server_apply_classification($1,$2,$3,array['Information Request'],null,0,'','',false,$4,1) applied",
      [workspace, id, revision, run],
    )
  ).rows[0].applied;
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const fix = files.findIndex((f) => f.endsWith("_replied_conversations.sql"));
  assert.ok(fix > 0);
  for (const file of files.slice(0, fix))
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'owner@inbox.example',now()),($2,'outsider@inbox.example',now())",
    [user, outsider],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  workspace = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Reply eligibility') id",
    )
  ).rows[0].id;
  await db.query(
    "update public.connections set status='connected',revision=1 where workspace_id=$1",
    [workspace],
  );
  await db.query(
    "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,42,'Team sender',true)",
    [workspace],
  );
  // Reproduce the shipped bug before applying the new migration.
  oldRun = await importPage(["legacy-outreach", "legacy-replied"]);
  outreachId = (await ingest("legacy-outreach", [outbound], oldRun))
    .conversationId;
  repliedId = (await ingest("legacy-replied", [inbound, outbound], oldRun))
    .conversationId;
  assert.equal(await classify(outreachId, 0, oldRun), true);
  assert.equal(await classify(repliedId, 1, oldRun), true);
  for (const file of files.slice(fix, fix + 1))
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
});
after(() => db.close());

test("Populated upgrade hides existing outreach, repairs derived counts and retains messages", async () => {
  const visible = (
    await db.query<{ id: string }>(
      "select id from public.conversation_page($1)",
      [workspace],
    )
  ).rows;
  assert.deepEqual(
    visible.map((c) => c.id),
    [repliedId],
  );
  const legacy = (
    await db.query(
      "select labels,classified_revision,(select count(*)::int from public.messages where conversation_id=c.id) messages from public.conversations c where id=$1",
      [outreachId],
    )
  ).rows[0];
  assert.deepEqual(legacy, {
    labels: [],
    classified_revision: null,
    messages: 1,
  });
  const totals = (
    await db.query(
      "select status,inspected,imported,classified from public.import_runs where id=$1",
      [oldRun],
    )
  ).rows[0];
  assert.deepEqual(totals, {
    status: "completed",
    inspected: 2,
    imported: 1,
    classified: 1,
  });
  assert.equal(
    await classify(outreachId, 0),
    false,
    "late old-worker results must not restore outreach labels",
  );
});

test("Reply eligibility applies before pagination, search and labels while retaining tenant RLS", async () => {
  for (let i = 0; i < 6; i++) await ingest(`paging-outreach-${i}`, [outbound]);
  for (let i = 0; i < 3; i++) {
    const c = await ingest(`paging-replied-${i}`, [inbound, outbound]);
    await classify(c.conversationId, 1);
  }
  await db.exec("set role authenticated");
  try {
    const page = (
      await db.query<{
        id: string;
        contact_name: string;
        last_message_at: string;
      }>(
        "select id,contact_name,last_message_at from public.conversation_page($1,'paging','Information Request',null,null,2)",
        [workspace],
      )
    ).rows;
    assert.equal(page.length, 2);
    assert.ok(page.every((c) => c.contact_name.startsWith("paging-replied")));
    const next = (
      await db.query<{ id: string }>(
        "select id from public.conversation_page($1,'paging','Information Request',$2,$3,2)",
        [workspace, page[1].last_message_at, page[1].id],
      )
    ).rows;
    assert.equal(next.length, 1);
    assert.ok(!page.some((c) => c.id === next[0].id));
    assert.equal(
      (
        await db.query(
          "select id from public.conversation_page($1,'paging-outreach')",
          [workspace],
        )
      ).rows.length,
      0,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsider,
    ]);
    assert.equal(
      (
        await db.query("select id from public.conversation_page($1)", [
          workspace,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
  }
});

test("An import with only outreach and empty histories completes without classification jobs", async () => {
  const run = await importPage(["new-outreach", "empty-history"]);
  await ingest("new-outreach", [outbound], run);
  await ingest("empty-history", [], run);
  assert.deepEqual(
    (
      await db.query(
        "select status,inspected,imported,classified from public.import_runs where id=$1",
        [run],
      )
    ).rows[0],
    { status: "completed", inspected: 2, imported: 0, classified: 0 },
  );
  assert.equal(
    (
      await db.query(
        "select id from app_private.jobs where kind='classify' and payload->>'runId'=$1",
        [run],
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select id from public.conversation_page($1,'empty-history')",
        [workspace],
      )
    ).rows.length,
    0,
  );
});

test("The first reply exposes prior outreach once and later outgoing messages keep it visible", async () => {
  const reply = {
    ...inbound,
    key: "first-reply",
    occurredAt: "2026-09-06T09:00:00Z",
  };
  const result = await ingest("legacy-outreach", [outbound, reply]);
  assert.equal(result.conversationId, outreachId);
  assert.equal(result.revision, 1);
  await ingest("legacy-outreach", [outbound, reply]);
  await ingest("legacy-outreach", [
    outbound,
    reply,
    { ...outbound, key: "team-answer", occurredAt: "2026-09-06T10:00:00Z" },
  ]);
  const visible = (
    await db.query(
      "select id,inbound_revision from public.conversation_page($1,'legacy-outreach')",
      [workspace],
    )
  ).rows;
  assert.deepEqual(visible, [{ id: outreachId, inbound_revision: 1 }]);
  assert.equal(
    (
      await db.query(
        "select id from public.messages where conversation_id=$1",
        [outreachId],
      )
    ).rows.length,
    3,
  );
  assert.equal(
    (
      await db.query(
        "select id from app_private.jobs where kind='classify' and payload->>'conversationId'=$1 and payload->>'revision'='1' and payload->>'generateDraft'='true'",
        [outreachId],
      )
    ).rows.length,
    1,
  );
});
