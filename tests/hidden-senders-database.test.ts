import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Hidden senders leave lists, counts, AI work and notifications until shown again", async () => {
  const db = new PGlite();
  async function row<T = Record<string, unknown>>(
    sql: string,
    args: unknown[] = [],
  ) {
    return (await db.query<T>(sql, args)).rows[0];
  }
  async function rows<T = Record<string, unknown>>(
    sql: string,
    args: unknown[] = [],
  ) {
    return (await db.query<T>(sql, args)).rows;
  }
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(new URL(file, directory), "utf8"));
    const owner = randomUUID(),
      member = randomUUID();
    await db.query(
      "insert into auth.users(id,email) values($1,'owner@test.test'),($2,'member@test.test')",
      [owner, member],
    );
    const as = (user: string) =>
      db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await as(owner);
    const workspace = (
      await row<{ id: string }>(
        "select public.create_workspace('Hidden senders') id",
      )
    ).id;
    await db.query(
      "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'member')",
      [workspace, member],
    );
    const agent = randomUUID();
    await db.query("select public.save_agent($1,$2,0,$3)", [
      workspace,
      agent,
      JSON.stringify({
        name: "Sales",
        goal: "Help",
        knowledge: "Facts",
        language: "English",
        status: "active",
        replyGroups: ["positive", "neutral"],
      }),
    ]);
    await db.query("select public.set_default_agent($1,$2)", [
      workspace,
      agent,
    ]);
    await db.query(
      "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,10,'Sales',true),($1,11,'Hiring',true)",
      [workspace],
    );
    async function conversation(sender: number, thread: string) {
      const id = (
        await row<{ id: string }>(
          "insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision) values($1,$2,$3,'Sender','Lead',1) returning id",
          [workspace, thread, sender],
        )
      ).id;
      await db.query(
        "insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision) values($1,$2,$3,1,'Reply','ready',1)",
        [workspace, id, agent],
      );
      await db.query(
        "insert into public.leads(workspace_id,conversation_id,status) values($1,$2,'follow_up')",
        [workspace, id],
      );
      return id;
    }
    const sales = await conversation(10, "sales");
    const hiring = await conversation(11, "hiring");
    const hiringDraft = (
      await row<{ id: string }>(
        "select id from public.drafts where workspace_id=$1 and conversation_id=$2",
        [workspace, hiring],
      )
    ).id;
    const visible = async () => ({
      conversations: (
        await rows<{ id: string }>(
          "select id from public.conversation_page_v2($1)",
          [workspace],
        )
      ).map((r) => r.id),
      filtered: (
        await rows<{ id: string }>(
          `select id from public.conversation_page_v3($1,p_filters=>'[{"field":"read","operator":"is","values":["unread"]}]')`,
          [workspace],
        )
      ).length,
      filteredTotal: Number(
        (
          await row<{ n: number }>(
            `select public.conversation_count_v3($1,p_filters=>'[{"field":"read","operator":"is","values":["unread"]}]') n`,
            [workspace],
          )
        ).n,
      ),
      counts: (
        await row<{ c: { all: number } }>(
          "select public.conversation_counts($1) c",
          [workspace],
        )
      ).c.all,
      drafts: (
        await rows<{ conversation_id: string }>(
          "select conversation_id from public.draft_page($1)",
          [workspace],
        )
      ).map((r) => r.conversation_id),
      leads: (
        await rows<{ id: string }>(
          "select id from public.lead_page($1,p_status=>'all')",
          [workspace],
        )
      ).map((r) => r.id),
      leadCounts: (
        await row<{ c: { all: number; follow_up?: number } }>(
          "select public.lead_counts($1) c",
          [workspace],
        )
      ).c,
      agent: (
        await row<{ id: string | null }>(
          "select public.server_resolve_agent($1,$2) id",
          [workspace, hiring],
        )
      ).id,
    });
    await db.exec(
      "update public.conversations set unread=true where workspace_id is not null",
    );
    const before = await visible();
    const both = [hiring, sales].sort();
    assert.deepEqual(
      {
        ...before,
        conversations: before.conversations.sort(),
        drafts: before.drafts.sort(),
        leads: before.leads.sort(),
      },
      {
        conversations: both,
        filtered: 2,
        filteredTotal: 2,
        counts: 2,
        drafts: both,
        leads: both,
        leadCounts: { all: 2, active: 2, completed: 0, follow_up: 2 },
        agent,
      },
    );

    // Work queued before hiding: a classification and a Telegram notification.
    await db.query(
      "insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values($1,'classify','live:hiring:1',$2)",
      [
        workspace,
        JSON.stringify({
          conversationId: hiring,
          revision: 1,
          runId: null,
          generateDraft: true,
        }),
      ],
    );
    const delivery = (
      await row<{ id: string }>(
        "insert into app_private.notification_deliveries(workspace_id,user_id,connection_id,bot_id,draft_id,draft_revision,source_revision,kind) values($1,$2,$3,1,$4,1,1,'draft') returning id",
        [workspace, owner, randomUUID(), hiringDraft],
      )
    ).id;

    await as(member);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.set_sender_hidden($1,11,true)", [workspace]),
      /Forbidden/,
    );
    await db.exec("reset role");
    await as(owner);
    await assert.rejects(
      db.query("select public.set_sender_hidden($1,99,true)", [workspace]),
      /Sender not found/,
    );

    await db.query("select public.set_sender_hidden($1,11,true)", [workspace]);
    assert.deepEqual(await visible(), {
      conversations: [sales],
      filtered: 1,
      filteredTotal: 1,
      counts: 1,
      drafts: [sales],
      leads: [sales],
      leadCounts: { all: 1, active: 1, completed: 0, follow_up: 1 },
      agent: null,
    });
    assert.equal(
      (
        await row<{ status: string }>(
          "select status from app_private.jobs where dedup_key='live:hiring:1'",
        )
      ).status,
      "done",
    );
    assert.equal(
      (
        await row<{ status: string }>(
          "select status from app_private.notification_deliveries where id=$1",
          [delivery],
        )
      ).status,
      "skipped",
    );
    // Nothing is deleted: the draft and lead stay stored.
    assert.equal(
      (
        await row<{ status: string }>(
          "select status from public.drafts where id=$1",
          [hiringDraft],
        )
      ).status,
      "ready",
    );

    // New replies from a hidden sender are not classified; imports still finish.
    await db.query(
      "insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values($1,'classify','live:hiring:2',$2)",
      [
        workspace,
        JSON.stringify({
          conversationId: hiring,
          revision: 2,
          runId: null,
          generateDraft: true,
        }),
      ],
    );
    assert.equal(
      (
        await rows(
          "select 1 from app_private.jobs where dedup_key='live:hiring:2'",
        )
      ).length,
      0,
    );
    const run = (
      await row<{ id: string }>(
        "insert into public.import_runs(workspace_id,days,window_start,status,scan_finished) values($1,7,now()-interval '7 days','running',true) returning id",
        [workspace],
      )
    ).id;
    await db.query(
      "insert into app_private.import_items(workspace_id,run_id,provider_key,conversation_id,ingested) values($1,$2,'11:hiring',$3,true)",
      [workspace, run, hiring],
    );
    await db.query(
      "insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values($1,'classify',$2,$3)",
      [
        workspace,
        `${run}:hiring:1`,
        JSON.stringify({
          conversationId: hiring,
          revision: 1,
          runId: run,
          generateDraft: false,
        }),
      ],
    );
    assert.deepEqual(
      await row(
        "select i.skipped,i.classified,r.status from app_private.import_items i join public.import_runs r on r.id=i.run_id where i.run_id=$1",
        [run],
      ),
      { skipped: true, classified: false, status: "completed" },
    );
    // Visible senders are classified as before.
    await db.query(
      "insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values($1,'classify','live:sales:2',$2)",
      [
        workspace,
        JSON.stringify({
          conversationId: sales,
          revision: 2,
          runId: null,
          generateDraft: true,
        }),
      ],
    );
    assert.equal(
      (
        await rows(
          "select 1 from app_private.jobs where dedup_key='live:sales:2'",
        )
      ).length,
      1,
    );

    // New conversations inherit the sender's flag.
    const later = (
      await row<{ sender_hidden: boolean }>(
        "insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name) values($1,'later',11,'Hiring','Lead') returning sender_hidden",
        [workspace],
      )
    ).sender_hidden;
    assert.equal(later, true);

    await db.query("select public.set_sender_hidden($1,11,false)", [workspace]);
    const shown = await visible();
    assert.deepEqual(shown.conversations.sort(), [hiring, sales].sort());
    assert.deepEqual(shown.drafts.sort(), [hiring, sales].sort());
    assert.equal(shown.counts, 2);
    assert.equal(shown.leadCounts.all, 2);
    assert.equal(shown.agent, agent);
  } finally {
    await db.close();
  }
});
