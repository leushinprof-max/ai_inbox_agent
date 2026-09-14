import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { normalizeConversation } from "../src/integrations/heyreach/client";

const db = new PGlite();
const owner = randomUUID();
const body = "Thanks! When would a call work for you?";
const initialTime = "2026-09-10T06:53:11.395Z";
const correctedTime = "2026-09-10T06:53:11.197Z";
type RawMessage = { createdAt: string; body: string; sender: "ME" | "THEM" };
const outbound = (createdAt: string): RawMessage => ({
  createdAt,
  body,
  sender: "ME",
});
const directory = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(directory)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const fix = files.find((f) =>
  f.endsWith("_reconcile_provider_timestamps.sql"),
)!;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  for (const file of files)
    await db.exec(readFileSync(new URL(file, directory), "utf8"));
  await db.query("insert into auth.users(id) values($1)", [owner]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
});
after(() => db.close());

async function fixture() {
  const workspace = randomUUID();
  const conversation = randomUUID();
  await db.query(
    "insert into public.workspaces(id,name) values($1,'Reconciliation')",
    [workspace],
  );
  await db.query(
    "insert into public.connections(workspace_id,status,revision) values($1,'connected',1)",
    [workspace],
  );
  await db.query(
    "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,42,'Sender',true)",
    [workspace],
  );
  await db.query(
    "insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name) values($1,$2,'chat',42,'Sender','Lead')",
    [conversation, workspace],
  );
  const normalize = (messages: RawMessage[]) =>
    normalizeConversation({
      id: "chat",
      linkedInAccountId: 42,
      messages,
    });
  const ingest = async (messages: RawMessage[]) =>
    (
      await db.query<{ result: { inserted: number; revision: number } }>(
        "select public.server_ingest_conversation($1,1,$2::jsonb) result",
        [workspace, JSON.stringify(normalize(messages))],
      )
    ).rows[0].result;
  const send = async (
    createdAt = "2026-09-10T06:53:10.308Z",
    status = "sent",
  ) => {
    const id = randomUUID();
    await db.query(
      "insert into public.send_operations(workspace_id,id,user_id,conversation_id,request,status,source_revision,created_at) values($1,$2,$3,$4,$5,'sending',0,$6)",
      [
        workspace,
        id,
        owner,
        conversation,
        JSON.stringify({ body, draftId: randomUUID() }),
        createdAt,
      ],
    );
    if (status !== "sending")
      await db.query("select public.server_complete_send($1,$2,$3)", [
        workspace,
        id,
        status,
      ]);
    return id;
  };
  const messages = async () =>
    (
      await db.query<{
        id: string;
        ingestion_key: string;
        source: string;
        body: string;
        occurred_at: Date;
        direction: string;
      }>(
        "select * from public.messages where workspace_id=$1 order by occurred_at,id",
        [workspace],
      )
    ).rows;
  const operation = async (id: string) =>
    (
      await db.query<{
        message_id: string;
        status: string;
        request: { draftId: string };
      }>(
        "select message_id,status,request from public.send_operations where workspace_id=$1 and id=$2",
        [workspace, id],
      )
    ).rows[0];
  return {
    workspace,
    conversation,
    normalize,
    ingest,
    send,
    messages,
    operation,
  };
}

test("A sent message keeps its ID and AI provenance when HeyReach corrects its timestamp", async () => {
  const f = await fixture();
  const id = await f.send();
  const original = await f.operation(id);
  for (const at of [
    initialTime,
    correctedTime,
    correctedTime,
    initialTime,
    correctedTime,
  ]) {
    assert.equal((await f.ingest([outbound(at)])).inserted, 0);
    const rows = await f.messages();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, original.message_id);
    assert.equal(rows[0].source, "provider");
    assert.equal(rows[0].occurred_at.toISOString(), at);
    assert.deepEqual(await f.operation(id), original);
  }
});

test("Timestamp correction can cross a second boundary", async () => {
  const f = await fixture();
  await f.send();
  await f.ingest([outbound("2026-09-10T06:53:11.087Z")]);
  await f.ingest([outbound("2026-09-10T06:53:10.841Z")]);
  assert.equal((await f.messages()).length, 1);
});

test("Existing duplicate rows are repaired from a provider snapshot after upgrading", async () => {
  const f = await fixture();
  const id = await f.send();
  const original = await f.operation(id);
  const previous = readFileSync(
    new URL("20260908053802_lead_profile_links.sql", directory),
    "utf8",
  );
  await db.exec(previous.slice(previous.indexOf("create or replace function")));
  await f.ingest([outbound(initialTime)]);
  await f.ingest([outbound(correctedTime)]);
  assert.equal(
    (await f.messages()).length,
    2,
    "Reproduces the old ingestion bug",
  );
  await db.exec(readFileSync(new URL(fix, directory), "utf8"));
  await f.ingest([outbound(correctedTime)]);
  assert.equal((await f.messages()).length, 1);
  assert.equal((await f.messages())[0].id, original.message_id);
  assert.deepEqual(await f.operation(id), original);
  assert.equal((await f.ingest([outbound(correctedTime)])).inserted, 0);
});

test("Genuine repeated messages present together in HeyReach remain separate", async () => {
  const f = await fixture();
  await f.send();
  await f.ingest([outbound(initialTime)]);
  const history = [
    outbound(initialTime),
    outbound(correctedTime),
    outbound(correctedTime),
  ];
  await f.ingest(history);
  assert.equal((await f.messages()).length, 3);
  assert.equal((await f.ingest(history)).inserted, 0);
});

test("Multiple new matching provider messages do not get collapsed into a previous send", async () => {
  const f = await fixture();
  await f.send();
  await f.ingest([outbound(initialTime)]);
  await f.ingest([
    outbound(correctedTime),
    outbound("2026-09-10T06:53:11.600Z"),
  ]);
  assert.equal((await f.messages()).length, 3);
});

test("Two separate platform send operations are never merged", async () => {
  const f = await fixture();
  const first = await f.send();
  await f.ingest([outbound(initialTime)]);
  const second = await f.send("2026-09-10T06:53:11.700Z");
  await f.ingest([outbound(initialTime), outbound("2026-09-10T06:53:11.800Z")]);
  const firstMessage = (await f.operation(first)).message_id;
  const secondMessage = (await f.operation(second)).message_id;
  assert.notEqual(firstMessage, secondMessage);
  assert.equal((await f.messages()).length, 2);
  await f.ingest([outbound(correctedTime)]);
  assert.equal(
    (await f.messages()).length,
    3,
    "Ambiguous correction must preserve both operations",
  );
  assert.equal((await f.operation(first)).message_id, firstMessage);
  assert.equal((await f.operation(second)).message_id, secondMessage);
});

test("Inbound, external outbound and later identical messages remain distinct", async () => {
  const external = await fixture();
  await external.ingest([outbound(initialTime)]);
  await external.ingest([outbound(correctedTime)]);
  assert.equal((await external.messages()).length, 2);
  const inbound = await fixture();
  await inbound.ingest([{ ...outbound(initialTime), sender: "THEM" }]);
  await inbound.ingest([{ ...outbound(correctedTime), sender: "THEM" }]);
  assert.equal((await inbound.messages()).length, 2);
  const later = await fixture();
  await later.send();
  await later.ingest([outbound(initialTime)]);
  await later.ingest([outbound("2026-09-10T06:54:11.395Z")]);
  assert.equal((await later.messages()).length, 2);
});

test("Reconciliation is scoped to the workspace and conversation", async () => {
  const a = await fixture();
  const b = await fixture();
  await a.send();
  await a.ingest([outbound(initialTime)]);
  await b.ingest([outbound(correctedTime)]);
  assert.equal((await a.messages()).length, 1);
  assert.equal((await b.messages()).length, 1);
  const other = { ...a.normalize([outbound(correctedTime)]), id: "other-chat" };
  await db.query("select public.server_ingest_conversation($1,1,$2::jsonb)", [
    a.workspace,
    JSON.stringify(other),
  ]);
  assert.equal((await a.messages()).length, 2);
});

test("Readback before completion and unknown send recovery remain idempotent", async () => {
  for (const status of ["sending", "unknown"]) {
    const f = await fixture();
    const id = await f.send(undefined, status);
    await f.ingest([outbound(initialTime)]);
    const original = (await f.operation(id)).message_id;
    await db.query("select public.server_complete_send($1,$2,'sent')", [
      f.workspace,
      id,
    ]);
    await f.ingest([outbound(correctedTime)]);
    assert.equal((await f.messages()).length, 1);
    assert.equal((await f.operation(id)).message_id, original);
    assert.equal((await f.operation(id)).status, "sent");
  }
});

test("Correcting outbound identity preserves read state, inbound revision and classification jobs", async () => {
  const f = await fixture();
  const incoming: RawMessage = {
    body: "Can we talk?",
    createdAt: "2026-09-09T12:00:00Z",
    sender: "THEM",
  };
  await f.ingest([incoming]);
  await f.send();
  await f.ingest([incoming, outbound(initialTime)]);
  await db.query("update public.conversations set unread=false where id=$1", [
    f.conversation,
  ]);
  const state = async () =>
    (
      await db.query(
        "select unread,inbound_revision,read_state_revision,(select count(*) from app_private.jobs where workspace_id=$1) jobs from public.conversations where id=$2",
        [f.workspace, f.conversation],
      )
    ).rows[0];
  const before = await state();
  await f.ingest([incoming, outbound(correctedTime)]);
  assert.deepEqual(await state(), before);
  assert.equal((await f.messages()).length, 2);
  await assert.rejects(
    db.query("select public.server_ingest_conversation($1,2,$2::jsonb)", [
      f.workspace,
      JSON.stringify(f.normalize([incoming, outbound(initialTime)])),
    ]),
    /Connection changed/,
  );
  assert.deepEqual(await state(), before);
});

test("The reconciliation helper has no browser access and does not add definer privileges", async () => {
  const permissions = (
    await db.query(`select
    has_function_privilege('anon',p.oid,'EXECUTE') anonymous,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') worker,
    p.prosecdef definer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname='reconcile_provider_timestamp'`)
  ).rows;
  assert.deepEqual(permissions, [
    { anonymous: false, authenticated: false, worker: true, definer: false },
  ]);
});
