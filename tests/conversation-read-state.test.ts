import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createDemoState } from "../src/demo/data";
import { DemoRepository } from "../src/demo/repository";

test("Shared read state: populated migration, roles, CAS, ingestion, import and whole-workspace queries", async () => {
  const db = new PGlite();
  const row = async <T = Record<string, unknown>>(
    sql: string,
    args: unknown[] = [],
  ) => (await db.query<T>(sql, args)).rows[0];
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create schema auth;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const change = files.findIndex((f) =>
      f.endsWith("_shared_conversation_read_state.sql"),
    );
    assert.ok(change > 0);
    for (const file of files.slice(0, change))
      await db.exec(readFileSync(new URL(file, dir), "utf8"));
    const owner = randomUUID(),
      admin = randomUUID(),
      member = randomUUID(),
      viewer = randomUUID(),
      outsider = randomUUID();
    for (const id of [owner, admin, member, viewer, outsider])
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        `${id}@example.test`,
      ]);
    const asUser = async (id: string) =>
      db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await asUser(owner);
    const workspace = (
      await row<{ id: string }>(
        "select public.create_workspace('Read states') id",
      )
    ).id;
    const foreign = (
      await row<{ id: string }>("select public.create_workspace('Other') id")
    ).id;
    for (const [user, role] of [
      [admin, "admin"],
      [member, "member"],
      [viewer, "viewer"],
    ])
      await db.query(
        "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,$3)",
        [workspace, user, role],
      );
    await db.query(
      "update public.connections set status='connected',revision=1 where workspace_id=$1",
      [workspace],
    );
    await db.query(
      "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,42,'Sender',true)",
      [workspace],
    );
    const ingest = async (
      name: string,
      key: string,
      direction = "inbound",
      run: string | null = null,
    ) =>
      (
        await row<{ result: { conversationId: string } }>(
          "select public.server_ingest_conversation($1,1,$2,$3) result",
          [
            workspace,
            JSON.stringify({
              id: name,
              senderId: 42,
              senderName: "Sender",
              contactName: name,
              company: "Example firm",
              messages: [
                {
                  key,
                  direction,
                  body: `Message ${key}`,
                  occurredAt: "2026-09-08T00:00:00Z",
                },
              ],
            }),
            run,
          ],
        )
      ).result.conversationId;
    const legacy = await ingest("Legacy", "old");
    for (const file of files.slice(change))
      await db.exec(readFileSync(new URL(file, dir), "utf8"));
    const status = async (id: string) =>
      row<{ unread: boolean; read_state_revision: number }>(
        "select unread,read_state_revision from public.conversations where id=$1",
        [id],
      );
    const mark = async (
      id: string,
      revision: number,
      unread: boolean,
      w = workspace,
    ) =>
      db.query("select public.set_conversation_read_state($1,$2,$3,$4)", [
        w,
        id,
        revision,
        unread,
      ]);
    assert.deepEqual(
      await status(legacy),
      { unread: false, read_state_revision: 0 },
      "existing history starts read",
    );
    const live = await ingest("Live", "first");
    assert.deepEqual(await status(live), {
      unread: true,
      read_state_revision: 1,
    });
    await ingest("Live", "first");
    assert.deepEqual(
      await status(live),
      { unread: true, read_state_revision: 1 },
      "redelivery has no effect",
    );
    // Separate authenticated users see and update the same durable record.
    for (const id of [owner, admin, member]) {
      await asUser(id);
      await db.exec("set role authenticated");
      const before = await status(live);
      await mark(live, before.read_state_revision, !before.unread);
      assert.equal((await status(live)).unread, !before.unread);
      await db.exec("reset role");
    }
    const confirmed = await status(live);
    await asUser(viewer);
    await db.exec("set role authenticated");
    assert.deepEqual(await status(live), confirmed);
    await assert.rejects(
      mark(live, confirmed.read_state_revision, true),
      /Forbidden/,
    );
    await assert.rejects(
      db.query("update public.conversations set unread=true where id=$1", [
        live,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "update public.conversations set read_state_revision=999 where id=$1",
        [live],
      ),
      /permission denied/,
    );
    assert.equal(
      (
        await row<{ n: number }>(
          "select count(*)::int n from public.conversation_page_v2($1)",
          [foreign],
        )
      ).n,
      0,
    );
    await db.exec("reset role");
    await asUser(outsider);
    await db.exec("set role authenticated");
    assert.equal(
      (
        await row<{ n: number }>(
          "select count(*)::int n from public.conversation_page_v2($1)",
          [workspace],
        )
      ).n,
      0,
    );
    assert.deepEqual(
      (
        await row<{ n: object }>("select public.conversation_counts($1) n", [
          workspace,
        ])
      ).n,
      {
        all: 0,
        unread: 0,
        interested: 0,
        meeting_request: 0,
        information_request: 0,
      },
    );
    await assert.rejects(
      mark(live, confirmed.read_state_revision, true),
      /Forbidden/,
    );
    await db.exec("reset role");
    await asUser(owner);
    const stale = (await status(live)).read_state_revision;
    await ingest("Live", "second");
    await assert.rejects(mark(live, stale, false), /Read state changed/);
    assert.equal(
      (await status(live)).unread,
      true,
      "late read cannot hide a new reply",
    );
    await mark(live, (await status(live)).read_state_revision, false);
    const beforeManual = (await status(live)).read_state_revision;
    await mark(live, beforeManual, true);
    await assert.rejects(mark(live, beforeManual, false), /Read state changed/);
    const manual = await status(live);
    await ingest("Live", "outgoing", "outbound");
    assert.deepEqual(await status(live), manual);
    await ingest("Live", "second");
    assert.deepEqual(await status(live), manual);
    const run = (
      await row<{ id: string }>("select public.start_history_import($1,7) id", [
        workspace,
      ])
    ).id;
    await ingest("Live", "historical", "inbound", run);
    assert.deepEqual(
      await status(live),
      manual,
      "history does not clear an existing unread",
    );
    await ingest("Legacy", "historical-read", "inbound", run);
    assert.deepEqual(
      await status(legacy),
      { unread: false, read_state_revision: 0 },
      "history does not reopen a read thread",
    );
    const imported = await ingest("New history", "import-only", "inbound", run);
    assert.deepEqual(await status(imported), {
      unread: false,
      read_state_revision: 0,
    });
    // Read state is independent of all the other conversation/draft fields.
    const before = (
      await row<{ data: Record<string, unknown> }>(
        "select to_jsonb(c)-'unread'-'read_state_revision' data from public.conversations c where id=$1",
        [live],
      )
    ).data;
    await mark(live, manual.read_state_revision, false);
    assert.deepEqual(
      (
        await row<{ data: Record<string, unknown> }>(
          "select to_jsonb(c)-'unread'-'read_state_revision' data from public.conversations c where id=$1",
          [live],
        )
      ).data,
      before,
    );
    // A filter must run before pagination, and counts must span all pages.
    const interested = (
      await row<{ id: string }>(
        "select id from public.workspace_labels where workspace_id=$1 and system_key='interested'",
        [workspace],
      )
    ).id;
    const custom = randomUUID();
    await db.query(
      "insert into public.workspace_labels(id,workspace_id,name,intent_group,color,instruction) values($1,$2,'Custom buyers','neutral','teal','A custom label')",
      [custom, workspace],
    );
    await db.query(
      `insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,contact_company,inbound_revision,classified_revision,label_state,label_id,unread,last_message_at)
      select $1,'page-'||i,42,'Sender','Person '||i,'Beyond page one',1,1,'classified',case when i<=60 then $2::uuid else $3::uuid end,i%2=0,now()-i*interval '1 second' from generate_series(1,120) i`,
      [workspace, interested, custom],
    );
    await db.exec("set role authenticated");
    const counts = (
      await row<{ n: { all: number; unread: number; interested: number } }>(
        "select public.conversation_counts($1) n",
        [workspace],
      )
    ).n;
    assert.equal(counts.all, 123);
    assert.equal(counts.interested, 60);
    assert.equal(counts.unread, 60);
    const page = (
      q = "",
      label: string | null = null,
      at: string | null = null,
      id: string | null = null,
      read = "all",
    ) =>
      db.query<{ id: string; last_message_at: string; created_at: string }>(
        "select * from public.conversation_page_v2($1,$2,$3,$4,$5,50,$6)",
        [workspace, q, label, at, id, read],
      );
    const first = (await page("Beyond page one")).rows;
    assert.equal(first.length, 50);
    const last = first.at(-1)!;
    const second = (
      await page("Beyond page one", null, last.last_message_at, last.id)
    ).rows;
    assert.equal(second.length, 50);
    assert.equal(new Set([...first, ...second].map((c) => c.id)).size, 100);
    assert.equal(
      (await page("", custom, null, null, "unread")).rows.length,
      30,
    );
    assert.equal(
      (await page("", "group:neutral", null, null, "read")).rows.length,
      30,
    );
    assert.equal(
      (await page("Message import-only")).rows.length,
      1,
      "latest message text is searchable",
    );
    assert.equal((await page("no such message")).rows.length, 0);
    assert.equal(
      (await page("%_")).rows.length,
      0,
      "wildcards are literal input",
    );
    await db.exec("reset role");
    await db.exec("set role anon");
    await assert.rejects(mark(live, 0, true), /permission denied/);
  } finally {
    await db.close();
  }
});

test("Demo read state is shared, versioned and rejects a viewer", async () => {
  const fixture = createDemoState();
  fixture.memberships.push({
    workspaceId: fixture.workspaces[0].id,
    userId: "read-viewer",
    name: "Read viewer",
    email: "viewer@example.test",
    role: "viewer",
  });
  const repo = new DemoRepository(fixture);
  const state = repo.getSnapshot();
  const owner = state.memberships.find((m) => m.role === "owner")!;
  const scope = { workspaceId: owner.workspaceId, userId: owner.userId };
  const c = state.conversations.find(
    (c) => c.workspaceId === scope.workspaceId,
  )!;
  await repo.setConversationRead(scope, c.id, c.readStateRevision, true);
  assert.equal(
    repo.getSnapshot().conversations.find((x) => x.id === c.id)!.unread,
    true,
  );
  await assert.rejects(
    repo.setConversationRead(scope, c.id, c.readStateRevision, false),
  );
  const viewer = state.memberships.find((m) => m.role === "viewer");
  if (viewer)
    await assert.rejects(
      repo.setConversationRead(
        { workspaceId: viewer.workspaceId, userId: viewer.userId },
        c.id,
        c.readStateRevision + 1,
        false,
      ),
    );
});
