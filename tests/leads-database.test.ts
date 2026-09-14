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

interface LeadRow {
  status: string;
  state: string;
  revision: number;
  sent_count: number;
  due_at: Date | null;
  entered_at: Date;
  anchor_id: string | null;
}
interface DraftRow {
  id: string;
  status: string;
  revision: number;
  follow_up_number: number;
  source_revision: number;
  body: string;
}
async function fixture(attempts = 2, waitDays?: number[]) {
  const owner = randomUUID(),
    agent = randomUUID(),
    conversation = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    owner,
    `${owner}@test.test`,
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const workspace = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Lead test') id",
    )
  ).rows[0].id;
  const config = {
    name: "Follow-up agent",
    status: "active",
    goal: "Book a meeting",
    knowledge: "Approved product information.",
    replyGroups: ["positive"],
    followUps: {
      enabled: true,
      attempts,
      minDays: 2,
      maxDays: 4,
      ...(waitDays ? { waitDays } : {}),
      instructions: "Keep it short",
      examples: [],
    },
  };
  await db.query("select public.save_agent($1,$2,0,$3)", [
    workspace,
    agent,
    JSON.stringify(config),
  ]);
  await db.query("select public.set_default_agent($1,$2)", [workspace, agent]);
  await db.query(
    "update public.connections set status='connected',revision=1 where workspace_id=$1",
    [workspace],
  );
  await db.query(
    "insert into public.senders(workspace_id,provider_id,name,auth_valid) values($1,1,'Sender',true)",
    [workspace],
  );
  const label = async (key: string) =>
    (
      await db.query<{ id: string }>(
        "select id from public.workspace_labels where workspace_id=$1 and system_key=$2",
        [workspace, key],
      )
    ).rows[0].id;
  await db.query(
    "insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision,classified_revision,label_id,label_source,label_state) values($1,$2,'lead-test',1,'Sender','Interested lead',1,1,$3,'ai','classified')",
    [conversation, workspace, await label("interested")],
  );
  await db.query(
    "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values($1,$2,'inbound','Tell me more','inbound','provider',now()-interval '1 day')",
    [workspace, conversation],
  );
  const lead = async () =>
    (
      await db.query<LeadRow>(
        "select * from public.leads where workspace_id=$1 and conversation_id=$2",
        [workspace, conversation],
      )
    ).rows[0];
  const draft = async () =>
    (
      await db.query<DraftRow>(
        "select * from public.drafts where workspace_id=$1 and conversation_id=$2 and status in ('ready','needs_input','snoozed')",
        [workspace, conversation],
      )
    ).rows[0];
  const status = async (value: string, until: string | null = null) =>
    db.query("select public.set_lead_status($1,$2,$3,$4,$5)", [
      workspace,
      conversation,
      (await lead()).revision,
      value,
      until,
    ]);
  const send = async (d?: DraftRow, outcome = "sent") => {
    const id = randomUUID();
    const source = (
      await db.query<{ inbound_revision: number }>(
        "select inbound_revision from public.conversations where id=$1",
        [conversation],
      )
    ).rows[0].inbound_revision;
    await db.query("select public.reserve_send($1,$2,$3,$4,$5,$6,$7,1)", [
      workspace,
      id,
      conversation,
      d?.body ?? "Our considered reply",
      d?.id ?? null,
      d?.revision ?? null,
      source,
    ]);
    await db.query("select public.server_complete_send($1,$2,$3)", [
      workspace,
      id,
      outcome,
    ]);
    return id;
  };
  const due = async () => {
    await db.query(
      "update public.leads set due_at=now()-interval '1 second' where workspace_id=$1 and conversation_id=$2",
      [workspace, conversation],
    );
    await db.query("select public.server_schedule_follow_ups()");
  };
  const complete = async (revision = NaN, missing = "") => {
    const context = (
      await db.query<{
        config: number;
        catalog: number;
        source: number;
        version: number;
      }>(
        "select r.version_id config,w.label_revision catalog,c.inbound_revision source,a.version from public.ai_config_release r,public.workspaces w,public.conversations c,public.agents a where w.id=$1 and c.id=$2 and a.id=$3",
        [workspace, conversation, agent],
      )
    ).rows[0];
    return (
      await db.query<{ id: string | null }>(
        "select public.server_complete_follow_up($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null) id",
        [
          workspace,
          conversation,
          Number.isNaN(revision) ? (await lead()).revision : revision,
          agent,
          context.version,
          context.source,
          context.config,
          context.catalog,
          missing
            ? ""
            : "Following up on our conversation. Would a walkthrough help?",
          missing,
        ],
      )
    ).rows[0].id;
  };
  const inbound = async (body = "Thanks, tell me more") => {
    await db.query(
      "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values($1,$2,$3,$4,'inbound','provider',clock_timestamp())",
      [workspace, conversation, randomUUID(), body],
    );
    await db.query(
      "update public.conversations set inbound_revision=inbound_revision+1,last_message_at=clock_timestamp() where id=$1",
      [conversation],
    );
  };
  return {
    workspace,
    conversation,
    owner,
    agent,
    config,
    label,
    lead,
    draft,
    status,
    send,
    due,
    complete,
    inbound,
  };
}

test("positive admission automatically schedules follow-ups after our reply and survives reclassification", async () => {
  const f = await fixture();
  const entered = (await f.lead()).entered_at;
  assert.equal((await f.lead()).state, "waiting_reply");
  assert.equal((await f.lead()).due_at, null);
  await f.send();
  assert.equal((await f.lead()).status, "follow_up");
  assert.ok((await f.lead()).due_at);
  await db.query("update public.conversations set label_id=$1 where id=$2", [
    await f.label("not_interested"),
    f.conversation,
  ]);
  assert.deepEqual((await f.lead()).entered_at, entered);
  assert.equal((await f.lead()).status, "follow_up");
  const planned = await f.lead();
  assert.equal(planned.state, "scheduled");
  const days = (+new Date(planned.due_at!) - Date.now()) / 86_400_000;
  assert.ok(days > 1.99 && days <= 4);
  await db.query("select public.server_schedule_follow_ups()");
  await db.query(
    "update public.conversations set label_id=label_id where id=$1",
    [f.conversation],
  );
  assert.deepEqual(
    (await f.lead()).due_at,
    planned.due_at,
    "polling and classification do not reroll the interval",
  );
});

test("each configured wait starts at actual delivery, the final wait is retained, and a reply resets the first step", async () => {
  const f = await fixture(3, [2, 5, 9]);
  const expectWait = async (operation: string, days: number) => {
    const result = await db.query<{ days: string }>(
      "select (extract(epoch from (l.due_at-s.updated_at))/86400)::text days from public.leads l join public.send_operations s on s.id=$1 where l.workspace_id=$2 and l.conversation_id=$3",
      [operation, f.workspace, f.conversation],
    );
    assert.equal(Number(result.rows[0].days), days);
  };
  await expectWait(await f.send(), 2);
  const planned = (await f.lead()).due_at;
  await db.query("select public.server_schedule_follow_ups()");
  assert.deepEqual((await f.lead()).due_at, planned);
  for (const [index, days] of [5, 9, 9].entries()) {
    await f.due();
    await f.complete();
    const draft = await f.draft();
    assert.equal(draft.follow_up_number, index + 1);
    const scheduled = (await f.lead()).due_at;
    await db.query("select public.server_schedule_follow_ups()");
    assert.deepEqual(
      (await f.lead()).due_at,
      scheduled,
      "a prepared draft does not start the next wait",
    );
    await expectWait(await f.send(draft), days);
  }
  assert.equal((await f.lead()).sent_count, 3);
  assert.equal((await f.lead()).status, "follow_up");
  await f.inbound("Let's continue");
  await expectWait(await f.send(), 2);
  assert.equal((await f.lead()).sent_count, 0);
});

test("per-attempt settings are versioned and database validation rejects incomplete or invalid waits", async () => {
  const f = await fixture(2, [3, 7]);
  const snapshot = await db.query<{ followUps: unknown }>(
    "select configuration->'followUps' as \"followUps\" from public.agent_versions where agent_id=$1 and version=1",
    [f.agent],
  );
  assert.deepEqual(snapshot.rows[0].followUps, f.config.followUps);
  for (const waitDays of [
    [],
    [3],
    [3, 4, 5],
    [0, 4],
    [3, 366],
    [1.5, 4],
    ["3", 4],
    [null, 4],
    null,
    {},
  ]) {
    await assert.rejects(
      db.query("select public.save_agent($1,$2,1,$3)", [
        f.workspace,
        f.agent,
        JSON.stringify({
          ...f.config,
          followUps: { ...f.config.followUps, waitDays },
        }),
      ]),
      /follow_ups_check/,
    );
  }
});

test("one draft per attempt, dismissal does not count, confirmed delivery counts exactly once, and exhaustion waits for a reply", async () => {
  const f = await fixture();
  await f.status("follow_up");
  assert.equal((await f.lead()).state, "waiting_reply");
  await f.send();
  await f.due();
  await f.complete();
  const first = await f.draft();
  assert.equal(first.follow_up_number, 1);
  await f.complete();
  assert.equal((await f.draft()).id, first.id);
  assert.equal((await f.lead()).sent_count, 0);
  await db.query("select public.act_on_draft($1,$2,$3,'dismiss')", [
    f.workspace,
    first.id,
    first.revision,
  ]);
  assert.equal((await f.lead()).sent_count, 0);
  assert.equal((await f.lead()).state, "scheduled");
  assert.ok(
    +new Date((await f.lead()).due_at!) > Date.now() + 1.99 * 86_400_000,
  );
  await f.due();
  await f.complete();
  const op = await f.send(await f.draft(), "unknown");
  assert.equal((await f.lead()).sent_count, 0);
  await db.query("select public.server_complete_send($1,$2,'sent')", [
    f.workspace,
    op,
  ]);
  await db.query("select public.server_complete_send($1,$2,'sent')", [
    f.workspace,
    op,
  ]);
  assert.equal((await f.lead()).sent_count, 1);
  await f.due();
  await f.complete();
  assert.equal((await f.draft()).follow_up_number, 2);
  await f.send(await f.draft());
  assert.equal((await f.lead()).sent_count, 2);
  await db.query("select public.server_schedule_follow_ups()");
  assert.equal(
    (await f.lead()).status,
    "follow_up",
    "last attempt retains a full response window",
  );
  await f.due();
  assert.equal((await f.lead()).status, "no_reply");
  assert.equal(await f.draft(), undefined);
  await f.inbound("Sorry for the delay, let's talk");
  assert.equal((await f.lead()).status, "no_reply");
  await f.status("follow_up");
  assert.equal((await f.lead()).state, "waiting_reply");
  await f.send();
  assert.equal((await f.lead()).sent_count, 0);
});

test("new inbound invalidates an in-flight result and a pending follow-up; our reply resets the unanswered budget", async () => {
  const f = await fixture(5);
  await f.send();
  await f.status("follow_up");
  await f.due();
  await f.complete();
  await f.send(await f.draft());
  await f.due();
  const revision = (await f.lead()).revision;
  await f.inbound();
  assert.equal(await f.complete(revision), null);
  assert.equal((await f.lead()).state, "waiting_reply");
  await f.send();
  assert.equal((await f.lead()).sent_count, 0);
  await f.due();
  await f.complete();
  assert.equal((await f.draft()).follow_up_number, 1);
  await f.inbound("No thanks, not interested");
  assert.equal(await f.draft(), undefined);
  assert.equal(
    (await f.lead()).status,
    "follow_up",
    "only the operator changes the lead status",
  );
  await f.send();
  await f.due();
  await f.complete();
  await f.send();
  assert.equal(
    (await f.lead()).sent_count,
    0,
    "a manual reply does not consume the pending draft's attempt",
  );
});

test("Later returns on its chosen date; closed outcomes cancel drafts and stale status writes fail", async () => {
  const f = await fixture();
  await f.status("later", new Date(Date.now() + 86_400_000).toISOString());
  await db.query("select public.server_schedule_follow_ups()");
  assert.equal((await f.lead()).status, "later");
  await db.query(
    "update public.leads set later_until=now()-interval '1 second' where conversation_id=$1",
    [f.conversation],
  );
  await db.query("select public.server_schedule_follow_ups()");
  assert.equal((await f.lead()).status, "follow_up");
  assert.equal((await f.lead()).state, "queued");
  await f.complete();
  assert.equal((await f.draft()).follow_up_number, 1);
  const revision = (await f.lead()).revision;
  await f.status("meeting_booked");
  assert.equal(await f.draft(), undefined);
  await assert.rejects(
    db.query("select public.set_lead_status($1,$2,$3,'disqualified')", [
      f.workspace,
      f.conversation,
      revision,
    ]),
    /Lead changed/,
  );
  await f.inbound();
  assert.equal((await f.lead()).status, "meeting_booked");
});

test("settings are versioned, disabled agents do not draft, and invalid intervals fail", async () => {
  const f = await fixture();
  const snapshot = (
    await db.query<{ configuration: { followUps: unknown } }>(
      "select configuration from public.agent_versions where agent_id=$1",
      [f.agent],
    )
  ).rows[0];
  assert.deepEqual(snapshot.configuration.followUps, f.config.followUps);
  await f.send();
  await f.status("follow_up");
  await db.query("select public.save_agent($1,$2,1,$3)", [
    f.workspace,
    f.agent,
    JSON.stringify({
      ...f.config,
      followUps: { ...f.config.followUps, enabled: false },
    }),
  ]);
  await f.due();
  assert.equal((await f.lead()).state, "disabled");
  await assert.rejects(
    db.query("select public.save_agent($1,$2,2,$3)", [
      f.workspace,
      f.agent,
      JSON.stringify({
        ...f.config,
        followUps: { ...f.config.followUps, minDays: 8, maxDays: 2 },
      }),
    ]),
    /follow_ups_check/,
  );
});

test("workspace RLS and read-only membership protect lead data and status mutations", async () => {
  const f = await fixture();
  const outsider = randomUUID(),
    viewer = randomUUID();
  await db.query(
    "insert into auth.users(id,email) values($1,'outsider@test.test'),($2,'viewer@test.test')",
    [outsider, viewer],
  );
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
    [f.workspace, viewer],
  );
  try {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsider,
    ]);
    assert.equal(
      (await db.query("select * from public.lead_page($1)", [f.workspace])).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("select public.set_lead_status($1,$2,1,'disqualified')", [
        f.workspace,
        f.conversation,
      ]),
      /Forbidden/,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      viewer,
    ]);
    assert.equal(
      (await db.query("select * from public.lead_page($1)", [f.workspace])).rows
        .length,
      1,
    );
    await assert.rejects(f.status("disqualified"), /Forbidden/);
    await assert.rejects(
      db.query(
        "update public.leads set status='disqualified' where workspace_id=$1",
        [f.workspace],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.server_schedule_follow_ups()"),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("failed jobs surface a retry without consuming attempts; needs-input follow-ups use the existing generation flow", async () => {
  const f = await fixture();
  await f.send();
  await f.status("follow_up");
  await f.due();
  const failedRevision = (await f.lead()).revision;
  await db.query(
    "update app_private.jobs set status='failed',error_code='model_not_configured' where workspace_id=$1 and kind='follow_up'",
    [f.workspace],
  );
  await db.query("select public.server_schedule_follow_ups()");
  assert.equal((await f.lead()).state, "error");
  await f.status("follow_up");
  assert.ok((await f.lead()).revision > failedRevision);
  assert.equal((await f.lead()).sent_count, 0);
  await f.due();
  await f.complete(NaN, "Which demo times are available?");
  const draft = await f.draft();
  assert.equal(draft.status, "needs_input");
  await db.query("select public.save_agent($1,$2,1,$3)", [
    f.workspace,
    f.agent,
    JSON.stringify({ ...f.config, goal: "Arrange a walkthrough" }),
  ]);
  const id = randomUUID();
  await db.query(
    "select public.request_draft_generation($1,$2,$3,1,$4,$5,'','Tuesday at 2pm',false)",
    [f.workspace, id, f.conversation, draft.id, draft.revision],
  );
  const context = (
    await db.query<{ config: number; catalog: number }>(
      "select r.version_id config,w.label_revision catalog from public.ai_config_release r,public.workspaces w where w.id=$1",
      [f.workspace],
    )
  ).rows[0];
  await db.query(
    "select public.server_complete_follow_up_generation($1,$2,'Would Tuesday at 2pm work?','',$3,$4,null)",
    [f.workspace, id, context.config, context.catalog],
  );
  assert.equal((await f.draft()).body, "Would Tuesday at 2pm work?");
  assert.equal((await f.draft()).follow_up_number, 1);
  assert.equal((await f.draft()).status, "ready");
  assert.equal(
    (
      await db.query<{ agent_version: number }>(
        "select agent_version from public.drafts where id=$1",
        [draft.id],
      )
    ).rows[0].agent_version,
    2,
  );
  assert.equal((await f.lead()).sent_count, 0);
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from public.draft_generations where id=$1",
        [id],
      )
    ).rows[0].status,
    "completed",
  );
  const rewriteId = randomUUID();
  const ready = await f.draft();
  await db.query(
    "select public.request_draft_generation_v2($1,$2,$3,1,$4,$5,'Make this shorter','','rewrite','My unsent edit to the follow-up')",
    [f.workspace, rewriteId, f.conversation, ready.id, ready.revision],
  );
  await db.query(
    "select public.server_complete_follow_up_generation($1,$2,'Tuesday at 2?','',$3,$4,null)",
    [f.workspace, rewriteId, context.config, context.catalog],
  );
  assert.equal((await f.draft()).body, "Tuesday at 2?");
  await db.query("select public.restore_previous_draft($1,$2,$3)", [
    f.workspace,
    ready.id,
    (await f.draft()).revision,
  ]);
  assert.equal((await f.draft()).body, "My unsent edit to the follow-up");
  assert.equal((await f.lead()).sent_count, 0);
});

test("lead table groups paused work separately from outcomes and reads the last inbound under RLS", async () => {
  const f = await fixture();
  await f.send();
  await f.status("later", new Date(Date.now() + 86400000).toISOString());
  const asOwner = async (sql: string, values: unknown[] = []) => {
    await db.exec("set role authenticated");
    try {
      return await db.query<Record<string, unknown>>(sql, values);
    } finally {
      await db.exec("reset role");
    }
  };
  const active = await asOwner(
    "select id from public.lead_page($1,'','active')",
    [f.workspace],
  );
  assert.deepEqual(
    active.rows.map((r) => r.id),
    [f.conversation],
  );
  assert.equal(
    (
      await asOwner("select id from public.lead_page($1,'','completed')", [
        f.workspace,
      ])
    ).rows.length,
    0,
  );
  const replies = await asOwner(
    "select * from public.lead_last_replies($1,$2)",
    [f.workspace, [f.conversation]],
  );
  assert.equal(replies.rows.length, 1);
  assert.ok(
    +new Date(replies.rows[0].replied_at as string) < Date.now() - 86000000,
    "a newer outbound does not replace the last inbound date",
  );
  for (const outcome of ["meeting_booked", "no_reply", "disqualified"]) {
    await f.status(outcome);
    assert.equal(
      (
        await asOwner("select id from public.lead_page($1,'','active')", [
          f.workspace,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await asOwner("select id from public.lead_page($1,'','completed')", [
          f.workspace,
        ])
      ).rows[0].id,
      f.conversation,
    );
    const counts = (
      await asOwner("select public.lead_counts($1) counts", [f.workspace])
    ).rows[0].counts as Record<string, number>;
    assert.equal(counts.active, 0);
    assert.equal(counts.completed, 1);
    assert.equal(counts.all, 1);
  }
  assert.equal(
    (
      await asOwner(
        "select id from public.lead_page($1,'no matching name','completed')",
        [f.workspace],
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asOwner(
        "select id from public.lead_page($1,'','completed','2000-01-01',$2)",
        [f.workspace, f.conversation],
      )
    ).rows.length,
    0,
  );
  const other = await fixture();
  assert.equal(
    (
      await asOwner("select id from public.lead_page($1,'','completed')", [
        f.workspace,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asOwner("select * from public.lead_last_replies($1,$2)", [
        f.workspace,
        [f.conversation],
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await asOwner("select * from public.lead_last_replies($1,$2)", [
        other.workspace,
        [f.conversation],
      ])
    ).rows.length,
    0,
  );
});

test("conversation agent switch fences in-flight work, preserves reviewed drafts, and resumes without an overdue burst", async () => {
  const f = await fixture();
  const toggle = (revision: number, enabled: boolean) =>
    db.query("select public.set_conversation_agent($1,$2,$3,$4)", [
      f.workspace,
      f.conversation,
      revision,
      enabled,
    ]);
  await f.send();
  await f.due();
  const oldRevision = (await f.lead()).revision;
  await toggle(0, false);
  assert.equal((await f.lead()).state, "disabled");
  assert.equal((await f.lead()).due_at, null);
  assert.equal(
    await f.complete(oldRevision),
    null,
    "an in-flight follow-up cannot appear after off",
  );
  await db.query("select public.server_schedule_follow_ups()");
  assert.equal((await f.lead()).state, "disabled");
  await assert.rejects(toggle(0, true), /changed/i);
  await toggle(1, true);
  assert.ok(+new Date((await f.lead()).due_at!) > Date.now() + 1.99 * 86400000);
  assert.equal(
    await f.complete(oldRevision),
    null,
    "off/on cannot revive a stale generation",
  );
  await f.due();
  await f.complete();
  const reviewed = await f.draft();
  const generation = randomUUID();
  await db.query(
    "select public.request_draft_generation($1,$2,$3,1,$4,$5,'Be concise')",
    [f.workspace, generation, f.conversation, reviewed.id, reviewed.revision],
  );
  await toggle(2, false);
  assert.deepEqual(
    await f.draft(),
    reviewed,
    "turning off preserves the already reviewed draft",
  );
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from public.draft_generations where id=$1",
        [generation],
      )
    ).rows[0].status,
    "cancelled",
  );
  await assert.rejects(
    db.query(
      "select public.request_draft_generation($1,$2,$3,1,$4,$5,'Rewrite again')",
      [
        f.workspace,
        randomUUID(),
        f.conversation,
        reviewed.id,
        reviewed.revision,
      ],
    ),
    /Turn on the agent/,
  );
  await db.query(
    "select public.server_complete_follow_up_generation($1,$2,'Stale replacement','',1,1,null)",
    [f.workspace, generation],
  );
  assert.deepEqual(await f.draft(), reviewed);
  await toggle(3, true);
  assert.equal((await f.lead()).state, "draft");
  assert.equal((await f.lead()).sent_count, 0);
  const viewer = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    viewer,
    `${viewer}@test.test`,
  ]);
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
    [f.workspace, viewer],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    viewer,
  ]);
  await assert.rejects(toggle(4, false), /Forbidden/);
  const other = await fixture();
  await assert.rejects(toggle(4, false), /Forbidden/);
  assert.notEqual(other.workspace, f.workspace);
});

test("classification still updates labels while a switch revision fences automatic replies", async () => {
  const f = await fixture();
  const toggle = (revision: number, enabled: boolean) =>
    db.query("select public.set_conversation_agent($1,$2,$3,$4)", [
      f.workspace,
      f.conversation,
      revision,
      enabled,
    ]);
  const message = (
    await db.query<{ id: string }>(
      "select id from public.messages where conversation_id=$1 and direction='inbound'",
      [f.conversation],
    )
  ).rows[0].id;
  const result = {
    labelId: await f.label("information_request"),
    evidenceMessageId: message,
    evidenceQuote: "Tell me more",
    shouldReply: true,
    draft: "Here is the overview.",
    missingKnowledge: "",
    contactStopped: false,
  };
  const apply = async (control: number) => {
    const context = (
      await db.query<{
        config: number;
        catalog: number;
        assignment: number;
        version: number;
      }>(
        "select r.version_id config,w.label_revision catalog,c.label_assignment_revision assignment,a.version from public.ai_config_release r,public.workspaces w,public.conversations c,public.agents a where w.id=$1 and c.id=$2 and a.id=$3",
        [f.workspace, f.conversation, f.agent],
      )
    ).rows[0];
    await db.query(
      "select public.server_apply_intent($1,$2,1,$3,$4,$5,$6,$7,$8,true,null,$9)",
      [
        f.workspace,
        f.conversation,
        context.assignment,
        context.catalog,
        context.config,
        JSON.stringify(result),
        f.agent,
        context.version,
        control,
      ],
    );
  };
  await toggle(0, false);
  await apply(0);
  assert.equal(await f.draft(), undefined);
  assert.equal(
    (
      await db.query<{ label_id: string }>(
        "select label_id from public.conversations where id=$1",
        [f.conversation],
      )
    ).rows[0].label_id,
    result.labelId,
  );
  await toggle(1, true);
  await apply(0);
  assert.equal(
    await f.draft(),
    undefined,
    "off/on fences an old classifier's writer result",
  );
  await apply(2);
  assert.equal((await f.draft()).body, "Here is the overview.");
  assert.equal((await f.lead()).status, "follow_up");
});
