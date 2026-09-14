import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const bot = 12345;
let telegram = 100;
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

async function actor(user: string) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
async function fixture() {
  const owner = randomUUID(),
    conversation = randomUUID(),
    agent = randomUUID();
  const telegramId = ++telegram;
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    owner,
    `${owner}@example.test`,
  ]);
  await actor(owner);
  const workspace = (
    await db.query<{ id: string }>(
      "select public.create_workspace('Notification fixture') id",
    )
  ).rows[0].id;
  await db.query("select public.save_agent($1,$2,0,$3)", [
    workspace,
    agent,
    JSON.stringify({
      name: "Agent",
      status: "active",
      goal: "Help leads",
      knowledge: "Approved information",
      replyGroups: ["positive"],
    }),
  ]);
  await db.query(
    "update public.connections set status='connected',revision=1 where workspace_id=$1",
    [workspace],
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
  const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
  const link = async () => {
    await db.query("select public.create_telegram_link($1,$2,$3)", [
      workspace,
      bot,
      tokenHash,
    ]);
    return db.query<{ connected: boolean }>(
      "select public.server_connect_telegram($1,$2,$3,$3,'jane','Jane') connected",
      [bot, tokenHash, telegramId],
    );
  };
  const draft = async (status = "ready", followUp: number | null = null) => {
    const id = randomUUID();
    await db.query(
      "insert into public.drafts(id,workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,follow_up_number,missing_knowledge) values($1,$2,$3,$4,1,$5,$6,1,$7,$8)",
      [
        id,
        workspace,
        conversation,
        agent,
        status === "ready" ? "Hello Jane" : "",
        status,
        followUp,
        status === "needs_input" ? "What is the price?" : null,
      ],
    );
    return id;
  };
  const notifications = async () =>
    (
      await db.query<{
        id: string;
        status: string;
        draft_id: string;
        operation_id: string;
        refresh_requested: boolean;
      }>(
        "select * from app_private.notification_deliveries where workspace_id=$1 order by created_at,id",
        [workspace],
      )
    ).rows;
  const reserve = async (id: string, from = telegramId) =>
    (
      await db.query<{ result: { kind: string; status: string } }>(
        "select public.server_reserve_telegram_send($1,$2,$3,$3,1) result",
        [id, bot, from],
      )
    ).rows[0].result;
  return {
    owner,
    workspace,
    conversation,
    telegramId,
    tokenHash,
    link,
    draft,
    notifications,
    reserve,
  };
}

async function deliver(id: string, approve = true) {
  // Claim the selected fixture only; other tests may intentionally leave pending records.
  await db.query(
    "update app_private.notification_deliveries set available_at=now()+interval '1 day' where id<>$1 and (status in ('pending','sending') or refresh_requested)",
    [id],
  );
  const n = (
    await db.query<{
      result: {
        id: string;
        leaseToken: string;
        skipped: boolean;
        canApprove: boolean;
      };
    }>("select public.server_claim_notification($1) result", [bot])
  ).rows[0].result;
  assert.equal(n.id, id);
  await db.query(
    "select public.server_prepare_notification($1,$2,'A complete reviewed draft',$3)",
    [id, n.leaseToken, approve],
  );
  await db.query("select public.server_finish_notification($1,$2,1000,null)", [
    id,
    n.leaseToken,
  ]);
  return n;
}

test("Self-service links are one-use, scoped, and cannot link a different Telegram account", async () => {
  const f = await fixture();
  assert.equal((await f.link()).rows[0].connected, true);
  assert.equal(
    (
      await db.query<{ connected: boolean }>(
        "select public.server_connect_telegram($1,$2,$3,$3,null,'Jane') connected",
        [bot, f.tokenHash, f.telegramId],
      )
    ).rows[0].connected,
    false,
  );
  await assert.rejects(
    db.query(
      "select public.server_connect_telegram($1,$2,$3,$3,null,'Other')",
      [bot, f.tokenHash, f.telegramId + 10000],
    ),
    /Link used/,
  );
  const stranger = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [stranger]);
  await actor(stranger);
  await assert.rejects(
    db.query("select public.get_notification_settings($1,$2)", [
      f.workspace,
      bot,
    ]),
    /Forbidden/,
  );
  await actor(f.owner);
  await db.query("select public.disconnect_telegram()");
  await assert.rejects(
    db.query("select public.server_connect_telegram($1,$2,$3,$3,null,'Jane')", [
      bot,
      f.tokenHash,
      f.telegramId,
    ]),
    /Link expired/,
  );
});

test("Connect creates no historical backlog; edits, follow-ups and disabled subscriptions do not ping", async () => {
  const f = await fixture();
  const old = await f.draft();
  await f.link();
  assert.equal((await f.notifications()).length, 0);
  await db.query(
    "update public.drafts set body='Updated',revision=revision+1 where id=$1",
    [old],
  );
  assert.equal((await f.notifications()).length, 0);
  await db.query("update public.drafts set status='dismissed' where id=$1", [
    old,
  ]);
  const followup = await f.draft("ready", 1);
  assert.equal((await f.notifications()).length, 0);
  await db.query("update public.drafts set status='dismissed' where id=$1", [
    followup,
  ]);
  await db.query("select public.set_notification_subscription($1,$2,false)", [
    f.workspace,
    bot,
  ]);
  await f.draft();
  assert.equal((await f.notifications()).length, 0);
});

test("Telegram reservation shares UI sending, is idempotent, and records the real approver", async () => {
  const f = await fixture();
  await f.link();
  await f.draft();
  const n = (await f.notifications())[0];
  await deliver(n.id);
  await actor(""); // Telegram has no browser JWT.
  assert.equal((await f.reserve(n.id)).kind, "reserved");
  assert.deepEqual(await f.reserve(n.id), {
    kind: "existing",
    status: "sending",
    reason: null,
  });
  const operation = (
    await db.query<{ user_id: string }>(
      "select user_id from public.send_operations where id=$1",
      [n.operation_id],
    )
  ).rows[0];
  assert.equal(operation.user_id, f.owner);
  await actor(f.owner);
  await assert.rejects(
    db.query(
      "select public.reserve_send($1,$2,$3,'Another reply',null,null,null,1)",
      [f.workspace, randomUUID(), f.conversation],
    ),
    /previous send/,
  );
  await db.query("select public.server_complete_send($1,$2,'sent',null)", [
    f.workspace,
    n.operation_id,
  ]);
  assert.equal((await f.reserve(n.id)).status, "sent");
  assert.equal((await f.notifications())[0].refresh_requested, true);
});

test("A different actor, changed draft, new inbound, removed access and disconnected account cannot approve", async () => {
  for (const change of [
    "actor",
    "draft",
    "inbound",
    "role",
    "disconnect",
  ] as const) {
    const f = await fixture();
    await f.link();
    const draftId = await f.draft();
    const n = (await f.notifications())[0];
    await deliver(n.id);
    if (change === "draft")
      await db.query(
        "update public.drafts set body='Different text',revision=revision+1 where id=$1",
        [draftId],
      );
    if (change === "inbound")
      await db.query(
        "update public.conversations set inbound_revision=2 where id=$1",
        [f.conversation],
      );
    if (change === "role")
      await db.query(
        "update public.workspace_members set role='viewer' where workspace_id=$1 and user_id=$2",
        [f.workspace, f.owner],
      );
    if (change === "disconnect")
      await db.query("select public.disconnect_telegram()");
    await assert.rejects(
      f.reserve(n.id, change === "actor" ? f.telegramId + 10000 : f.telegramId),
    );
    assert.equal(
      (
        await db.query(
          "select * from public.send_operations where workspace_id=$1",
          [f.workspace],
        )
      ).rows.length,
      0,
    );
  }
});

test("Needs-input drafts and previews without an approval button cannot send", async () => {
  for (const status of ["needs_input", "ready"]) {
    const f = await fixture();
    await f.link();
    await f.draft(status);
    const n = (await f.notifications())[0];
    await deliver(n.id, false);
    await assert.rejects(f.reserve(n.id), /Review the draft/);
  }
});

test("Telegram identities, tokens and delivery records are inaccessible to browser roles", async () => {
  const f = await fixture();
  await f.link();
  await db.exec("set role authenticated");
  try {
    for (const table of [
      "telegram_connections",
      "telegram_links",
      "notification_subscriptions",
      "notification_deliveries",
    ])
      await assert.rejects(
        db.query(`select * from app_private.${table}`),
        /permission denied/,
      );
    await assert.rejects(
      db.query("select public.server_telegram_action($1,$2,$3,$3)", [
        randomUUID(),
        bot,
        f.telegramId,
      ]),
      /permission denied/,
    );
    const result = await db.query(
      "select public.get_notification_settings($1,$2)",
      [f.workspace, bot],
    );
    assert.equal(result.rows.length, 1);
  } finally {
    await db.exec("reset role");
  }
});

test("An edit during initial Telegram delivery schedules an immediate card refresh", async () => {
  const f = await fixture();
  await f.link();
  const draft = await f.draft();
  const n = (await f.notifications())[0];
  await db.query(
    "update app_private.notification_deliveries set available_at=now()+interval '1 day' where id<>$1",
    [n.id],
  );
  const claimed = (
    await db.query<{ result: { leaseToken: string } }>(
      "select public.server_claim_notification($1) result",
      [bot],
    )
  ).rows[0].result;
  await db.query(
    "select public.server_prepare_notification($1,$2,'Full draft',true)",
    [n.id, claimed.leaseToken],
  );
  await db.query(
    "update public.drafts set revision=revision+1,body='Edited while delivering' where id=$1",
    [draft],
  );
  await db.query("select public.server_finish_notification($1,$2,1010,null)", [
    n.id,
    claimed.leaseToken,
  ]);
  assert.equal((await f.notifications())[0].refresh_requested, true);
  const refresh = (
    await db.query<{
      result: { id: string; status: string; canApprove: boolean };
    }>("select public.server_claim_notification($1) result", [bot])
  ).rows[0].result;
  assert.equal(refresh.id, n.id);
  assert.equal(refresh.status, "changed");
  assert.equal(refresh.canApprove, false);
});

test("Disabling notifications after a claim prevents delivery preparation", async () => {
  const f = await fixture();
  await f.link();
  await f.draft();
  const n = (await f.notifications())[0];
  await db.query(
    "update app_private.notification_deliveries set available_at=now()+interval '1 day' where id<>$1",
    [n.id],
  );
  const claimed = (
    await db.query<{ result: { leaseToken: string } }>(
      "select public.server_claim_notification($1) result",
      [bot],
    )
  ).rows[0].result;
  await db.query("select public.set_notification_subscription($1,$2,false)", [
    f.workspace,
    bot,
  ]);
  const prepared = (
    await db.query<{ allowed: boolean }>(
      "select public.server_prepare_notification($1,$2,'Full draft',true) allowed",
      [n.id, claimed.leaseToken],
    )
  ).rows[0].allowed;
  assert.equal(prepared, false);
});
