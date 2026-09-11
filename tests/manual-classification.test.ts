import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const owner = randomUUID(),
  member = randomUUID(),
  viewer = randomUUID(),
  outsider = randomUUID();
let workspace: string, agent: string, positive: string, negative: string;
async function row<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  return (await db.query<T>(sql, params)).rows[0];
}
async function user(id: string) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function privileged() {
  await db.exec("reset role");
}
async function setAgentStatus(status: "active" | "paused") {
  await user(owner);
  const version = (
    await row<{ version: number }>(
      "select version from public.agents where id=$1",
      [agent],
    )
  ).version;
  await db.query("select public.save_agent($1,$2,$3,$4)", [
    workspace,
    agent,
    version,
    JSON.stringify({
      name: "Writer",
      goal: "Help",
      language: "English",
      knowledge: "Approved facts",
      status,
      replyGroups: ["positive"],
    }),
  ]);
  await privileged();
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(new URL(file, directory), "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    owner,
    member,
    viewer,
    outsider,
  ]);
  await user(owner);
  workspace = (
    await row<{ id: string }>(
      "select public.create_workspace('Manual intent') id",
    )
  ).id;
  agent = randomUUID();
  await db.query("select public.save_agent($1,$2,0,$3)", [
    workspace,
    agent,
    JSON.stringify({
      name: "Writer",
      goal: "Help",
      language: "English",
      knowledge: "Approved facts",
      status: "active",
      replyGroups: ["positive"],
    }),
  ]);
  await db.query("select public.set_default_agent($1,$2)", [workspace, agent]);
  await privileged();
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'member'),($1,$3,'viewer')",
    [workspace, member, viewer],
  );
  positive = (
    await row<{ id: string }>(
      "select id from public.workspace_labels where workspace_id=$1 and system_key='interested'",
      [workspace],
    )
  ).id;
  negative = (
    await row<{ id: string }>(
      "select id from public.workspace_labels where workspace_id=$1 and intent_group='negative' limit 1",
      [workspace],
    )
  ).id;
});
after(() => db.close());

async function conversation() {
  await privileged();
  const id = randomUUID();
  await db.query(
    `insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,
    inbound_revision,classified_revision,label_state,label_source) values($1,$2,$3,42,'Sender','Lead',1,1,'uncategorized','ai')`,
    [id, workspace, id],
  );
  await db.query(
    `insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
    values($1,$2,$3,'Alex?','inbound','provider',now())`,
    [workspace, id, id],
  );
  return id;
}
async function assign(
  id: string,
  label: string | null = positive,
  assignment = 0,
  revision = 1,
) {
  return db.query("select public.assign_conversation_label($1,$2,$3,$4,$5)", [
    workspace,
    id,
    label,
    revision,
    assignment,
  ]);
}
async function generations(id: string) {
  await privileged();
  return (
    await db.query<{ id: string; status: string; agent_id: string }>(
      "select id,status,agent_id from public.draft_generations where workspace_id=$1 and conversation_id=$2 order by created_at,id",
      [workspace, id],
    )
  ).rows;
}

test("Manual classification queues one reply, preserves the label through draft completion and rejects duplicate/stale assignments", async () => {
  const id = await conversation();
  await user(member);
  await assign(id);
  const requests = await generations(id);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, "queued");
  assert.equal(requests[0].agent_id, agent);
  assert.deepEqual(
    await row(
      "select label_id,label_source,label_state,label_assignment_revision,evidence_message_id,evidence_quote from public.conversations where id=$1",
      [id],
    ),
    {
      label_id: positive,
      label_source: "manual",
      label_state: "classified",
      label_assignment_revision: 1,
      evidence_message_id: null,
      evidence_quote: "",
    },
  );
  const jobs = (
    await db.query<{ kind: string; payload: { generationId: string } }>(
      "select kind,payload from app_private.jobs where payload->>'generationId'=$1",
      [requests[0].id],
    )
  ).rows;
  assert.deepEqual(jobs, [
    { kind: "generate", payload: { generationId: requests[0].id } },
  ]);
  await user(member);
  await assert.rejects(assign(id), /Conversation changed/);
  await assign(id, positive, 1);
  assert.equal((await generations(id)).length, 1);
  const catalog = (
    await row<{ label_revision: number }>(
      "select label_revision from public.workspaces where id=$1",
      [workspace],
    )
  ).label_revision;
  await db.query(
    "select public.server_complete_generation_v2($1,$2,'Yes, this is Alex. How can I help?','',true,1,$3,1,'',false)",
    [workspace, requests[0].id, catalog],
  );
  assert.deepEqual(
    await row(
      "select body,status from public.drafts where conversation_id=$1",
      [id],
    ),
    { body: "Yes, this is Alex. How can I help?", status: "ready" },
  );
  assert.equal(
    (
      await row("select label_source from public.conversations where id=$1", [
        id,
      ])
    ).label_source,
    "manual",
  );
  // A classifier that started before the user's choice cannot overwrite it.
  await db.query(
    "select public.server_apply_intent($1,$2,1,0,$3,1,$4,$5,1,false)",
    [
      workspace,
      id,
      catalog,
      JSON.stringify({
        labelId: null,
        evidenceMessageId: null,
        evidenceQuote: "",
        contactStopped: false,
        shouldReply: false,
        draft: "",
        missingKnowledge: "",
      }),
      agent,
    ],
  );
  assert.equal(
    (await row("select label_id from public.conversations where id=$1", [id]))
      .label_id,
    positive,
  );
});

test("Manual labels save without drafting for disallowed groups, opt-outs, answered or archived conversations, and absent or paused agents", async () => {
  for (const reason of [
    "group",
    "stopped",
    "answered",
    "archived",
    "no_agent",
    "paused",
  ] as const) {
    const id = await conversation();
    if (reason === "stopped")
      await db.query(
        "update public.conversations set contact_stopped=true where id=$1",
        [id],
      );
    if (reason === "archived")
      await db.query(
        "update public.conversations set archived=true where id=$1",
        [id],
      );
    if (reason === "answered")
      await db.query(
        "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values($1,$2,'out','Already replied','outbound','provider',now()+interval '1 second')",
        [workspace, id],
      );
    if (reason === "no_agent")
      await db.query(
        "update public.workspaces set default_agent_id=null where id=$1",
        [workspace],
      );
    if (reason === "paused") await setAgentStatus("paused");
    await user(member);
    await assign(id, reason === "group" ? negative : positive);
    assert.equal((await generations(id)).length, 0, reason);
    assert.equal(
      (
        await row("select label_source from public.conversations where id=$1", [
          id,
        ])
      ).label_source,
      "manual",
    );
    if (reason === "no_agent")
      await db.query(
        "update public.workspaces set default_agent_id=$2 where id=$1",
        [workspace, agent],
      );
    if (reason === "paused") await setAgentStatus("active");
  }
});

test("Changing a manual label cancels a queued writer, and a late result cannot publish a draft", async () => {
  const id = await conversation();
  await user(member);
  await assign(id);
  const request = (await generations(id))[0];
  await user(member);
  await assign(id, negative, 1);
  assert.equal((await generations(id))[0].status, "cancelled");
  const catalog = (
    await row<{ label_revision: number }>(
      "select label_revision from public.workspaces where id=$1",
      [workspace],
    )
  ).label_revision;
  await db.query(
    "select public.server_complete_generation_v2($1,$2,'Obsolete reply','',true,1,$3,1,'',false)",
    [workspace, request.id, catalog],
  );
  assert.equal(
    (
      await db.query("select id from public.drafts where conversation_id=$1", [
        id,
      ])
    ).rows.length,
    0,
  );
  await user(member);
  await assign(id, positive, 2);
  assert.equal(
    (await generations(id)).filter((request) => request.status === "queued")
      .length,
    1,
  );
  await user(member);
  await assign(id, null, 3);
  assert.equal(
    (await generations(id)).filter((request) => request.status === "queued")
      .length,
    0,
  );
});

test("Existing human drafts are preserved for each active draft status", async () => {
  // Earlier test changed the agent status/version; use the current snapshot.
  await privileged();
  const version = (
    await row<{ version: number }>(
      "select version from public.agents where id=$1",
      [agent],
    )
  ).version;
  for (const status of ["ready", "needs_input", "snoozed"]) {
    const id = await conversation();
    await db.query(
      "insert into public.drafts(workspace_id,conversation_id,agent_id,agent_version,body,status,source_revision,snoozed_until) values($1,$2,$3,$4,'Human edit',$5,1,$6)",
      [
        workspace,
        id,
        agent,
        version,
        status,
        status === "snoozed" ? "2030-01-01T00:00:00Z" : null,
      ],
    );
    await user(member);
    await assign(id);
    assert.equal((await generations(id)).length, 0);
    assert.deepEqual(
      await row(
        "select body,status,revision from public.drafts where conversation_id=$1",
        [id],
      ),
      { body: "Human edit", status, revision: 1 },
    );
  }
});

test("Manual assignment enforces membership, active workspace labels, and conversation revisions", async () => {
  const id = await conversation();
  for (const denied of [viewer, outsider]) {
    await user(denied);
    await assert.rejects(assign(id), /Forbidden/);
  }
  await privileged();
  await db.exec("set role anon");
  await assert.rejects(assign(id), /permission denied/);
  await user(member);
  await assert.rejects(assign(id, positive, 0, 2), /Conversation changed/);
  await assert.rejects(assign(id, randomUUID()), /Label unavailable/);
  await privileged();
  await db.query(
    "update public.workspace_labels set enabled=false where id=$1",
    [negative],
  );
  await user(member);
  await assert.rejects(assign(id, negative), /Label unavailable/);
  assert.equal((await generations(id)).length, 0);
  assert.equal(
    (
      await row("select label_state from public.conversations where id=$1", [
        id,
      ])
    ).label_state,
    "uncategorized",
  );
});
