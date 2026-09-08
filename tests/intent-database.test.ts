import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const owner = randomUUID(),
  other = randomUUID(),
  viewer = randomUUID(),
  member = randomUUID();
let workspace: string,
  foreign: string,
  conversation: string,
  lead: string,
  meeting: string,
  interested: string,
  agent: string;
async function row<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  return (await db.query<T>(sql, params)).rows[0];
}
async function user(id: string) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function privileged() {
  await db.exec("reset role");
}
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;`,
  );
  for (const file of readdirSync(
    new URL("../supabase/migrations/", import.meta.url),
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test'),($3,'viewer@example.test'),($4,'member@example.test')",
    [owner, other, viewer, member],
  );
  await user(owner);
  workspace = (
    await row<{ id: string }>("select public.create_workspace('A') id")
  ).id;
  await user(other);
  foreign = (
    await row<{ id: string }>("select public.create_workspace('B') id")
  ).id;
  await privileged();
  await db.query(
    "insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer'),($1,$3,'member')",
    [workspace, viewer, member],
  );
  meeting = (
    await row<{ id: string }>(
      "select id from public.workspace_labels where workspace_id=$1 and system_key='meeting_request'",
      [workspace],
    )
  ).id;
  interested = (
    await row<{ id: string }>(
      "select id from public.workspace_labels where workspace_id=$1 and system_key='interested'",
      [workspace],
    )
  ).id;
  conversation = (
    await row<{ id: string }>(
      "insert into public.conversations(workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision) values($1,'test',1,'Team','Lead',1) returning id",
      [workspace],
    )
  ).id;
  lead = (
    await row<{ id: string }>(
      "insert into public.messages(workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at) values($1,$2,'lead','Let us meet Tuesday','inbound','provider',now()) returning id",
      [workspace, conversation],
    )
  ).id;
  agent = randomUUID();
  await user(owner);
  await db.query("select public.save_agent($1,$2,0,$3)", [
    workspace,
    agent,
    JSON.stringify({
      name: "Agent",
      status: "active",
      goal: "Help",
      knowledge: "Facts",
      language: "English",
      replyGroups: ["positive"],
    }),
  ]);
  await db.query("select public.set_default_agent($1,$2)", [workspace, agent]);
  await privileged();
});
after(() => db.close());
async function apply(
  overrides: Record<string, unknown> = {},
  extra: {
    assignment?: number;
    catalog?: number;
    config?: number;
    generate?: boolean;
  } = {},
) {
  await privileged();
  const c = await row<{
    inbound_revision: number;
    label_assignment_revision: number;
  }>("select * from public.conversations where id=$1", [conversation]);
  const w = await row<{ label_revision: number }>(
    "select label_revision from public.workspaces where id=$1",
    [workspace],
  );
  const v = await row<{ version_id: number }>(
    "select version_id from public.ai_config_release",
  );
  return (
    await row<{ ok: boolean }>(
      "select public.server_apply_intent($1,$2,$3,$4,$5,$6,$7,$8,1,$9) ok",
      [
        workspace,
        conversation,
        c.inbound_revision,
        extra.assignment ?? c.label_assignment_revision,
        extra.catalog ?? w.label_revision,
        extra.config ?? v.version_id,
        JSON.stringify({
          labelId: meeting,
          evidenceMessageId: lead,
          evidenceQuote: "meet Tuesday",
          shouldReply: false,
          noReplyReason: "Time confirmed.",
          contactStopped: false,
          draft: "",
          missingKnowledge: "",
          ...overrides,
        }),
        agent,
        extra.generate ?? true,
      ],
    )
  ).ok;
}
test("Catalogs isolate tenants and non-admins cannot edit rules; manual correction is member-only", async () => {
  await user(viewer);
  assert.equal(
    (await db.query("select * from public.workspace_labels")).rows.length,
    7,
  );
  await assert.rejects(
    db.query("select public.assign_conversation_label($1,$2,$3,1,0)", [
      workspace,
      conversation,
      meeting,
    ]),
  );
  await assert.rejects(
    db.query("select public.save_workspace_label($1,$2,0,$3)", [
      workspace,
      randomUUID(),
      JSON.stringify({
        name: "X",
        group: "positive",
        color: "blue",
        instruction: "X",
        enabled: true,
        archived: false,
      }),
    ]),
  );
  await user(owner);
  await assert.rejects(
    db.query(
      "select public.assign_conversation_label($1,$2,(select id from public.workspace_labels where workspace_id=$3 limit 1),1,0)",
      [foreign, conversation, foreign],
    ),
  );
  await privileged();
  assert.equal(
    new Set(
      (
        await db.query<{ color: string }>(
          "select color from public.workspace_labels where workspace_id=$1",
          [workspace],
        )
      ).rows.map((l) => l.color),
    ).size,
    7,
  );
});
test("Platform prompt ownership is separate from workspace ownership; versions publish and roll back", async () => {
  await user(owner);
  assert.equal(
    (
      await row<{ allowed: boolean }>(
        "select public.is_platform_owner() allowed",
      )
    ).allowed,
    false,
  );
  assert.equal(
    (await db.query("select * from public.ai_config_versions")).rows.length,
    0,
  );
  await assert.rejects(db.query("select public.publish_ai_configuration(1,1)"));
  await privileged();
  await db.query("insert into app_private.platform_owners values($1)", [owner]);
  await user(owner);
  const config = (
    await row<{ configuration: object }>(
      "select configuration from public.ai_config_versions where id=1",
    )
  ).configuration;
  const version = (
    await row<{ id: number }>("select public.save_ai_configuration($1) id", [
      JSON.stringify({
        ...config,
        models: { classification: "classifier", draft: "writer" },
        reasoning: { classification: "none", draft: "medium" },
      }),
    ])
  ).id;
  assert.deepEqual(
    (
      await row<{ models: object }>(
        "select configuration->'models' models from public.ai_config_versions where id=$1",
        [version],
      )
    ).models,
    { classification: "classifier", draft: "writer" },
  );
  assert.equal(
    (
      await row<{ version_id: number }>(
        "select version_id from public.ai_config_release",
      )
    ).version_id,
    1,
  );
  await db.query("select public.publish_ai_configuration($1,1)", [version]);
  assert.deepEqual(
    (
      await row<{ reasoning: object }>(
        "select configuration->'reasoning' reasoning from public.ai_config_versions v join public.ai_config_release r on r.version_id=v.id",
      )
    ).reasoning,
    { classification: "none", draft: "medium" },
    "Published versions preserve independent reasoning settings",
  );
  assert.deepEqual(
    (
      await row<{ models: object }>(
        "select configuration->'models' models from public.ai_config_versions v join public.ai_config_release r on r.version_id=v.id",
      )
    ).models,
    { classification: "classifier", draft: "writer" },
  );
  await assert.rejects(db.query("select public.publish_ai_configuration(1,1)"));
  await db.query("select public.publish_ai_configuration(1,2)");
  assert.equal(
    (
      await row<{ reasoning: object | null }>(
        "select configuration->'reasoning' reasoning from public.ai_config_versions v join public.ai_config_release r on r.version_id=v.id",
      )
    ).reasoning,
    null,
    "Rollback to a legacy version restores provider-default reasoning",
  );
  assert.equal(
    (
      await row<{ models: object | null }>(
        "select configuration->'models' models from public.ai_config_versions v join public.ai_config_release r on r.version_id=v.id",
      )
    ).models,
    null,
    "Rolling back to the original version restores server-default model selection",
  );
  assert.equal(
    (await db.query("select * from public.ai_config_publications")).rows.length,
    2,
  );
});
test("Manual correction wins against an in-flight result and next inbound returns to AI", async () => {
  assert.equal(await apply(), true);
  await user(member);
  await db.query("select public.assign_conversation_label($1,$2,$3,1,1)", [
    workspace,
    conversation,
    interested,
  ]);
  assert.equal(await apply({}, { assignment: 1 }), false);
  assert.equal(await apply(), false);
  await privileged();
  await db.query(
    "update public.conversations set inbound_revision=2 where id=$1",
    [conversation],
  );
  assert.equal(await apply(), true);
  const current = await row<{ label_id: string; label_state: string }>(
    "select label_id,label_state from public.conversations where id=$1",
    [conversation],
  );
  assert.equal(current.label_id, meeting);
  assert.equal(current.label_state, "classified");
});
test("No-reply reason is independent of label and null result remains distinguishable", async () => {
  await apply();
  assert.equal(
    (
      await row<{ no_reply_reason: string }>(
        "select no_reply_reason from public.conversations where id=$1",
        [conversation],
      )
    ).no_reply_reason,
    "Time confirmed.",
  );
  assert.equal(
    (
      await db.query("select id from public.drafts where conversation_id=$1", [
        conversation,
      ])
    ).rows.length,
    0,
  );
  await apply({
    labelId: null,
    evidenceMessageId: null,
    evidenceQuote: "",
    shouldReply: true,
    draft: "Must not be generated",
  });
  assert.equal(
    (
      await row<{ label_state: string }>(
        "select label_state from public.conversations where id=$1",
        [conversation],
      )
    ).label_state,
    "uncategorized",
  );
  await user(owner);
  assert.equal(
    (
      await db.query(
        "select id from public.conversation_page($1,'','uncategorized')",
        [workspace],
      )
    ).rows.length,
    1,
  );
});
test("Stale catalog/config and fabricated evidence cannot create assignments or drafts", async () => {
  await assert.rejects(apply({}, { catalog: 0 }));
  await assert.rejects(apply({}, { config: 999 }));
  await assert.rejects(apply({ evidenceQuote: "made up" }));
  const foreignLabel = (
    await row<{ id: string }>(
      "select id from public.workspace_labels where workspace_id=$1 limit 1",
      [foreign],
    )
  ).id;
  await assert.rejects(apply({ labelId: foreignLabel }));
  await assert.rejects(
    db.query(
      "select public.server_apply_classification($1,$2,2,array['Interested'],null,0,'','',false)",
      [workspace, conversation],
    ),
  );
});
test("Group restrictions and explicit contact stop hold even when model requests a draft", async () => {
  await apply({ shouldReply: true, draft: "Draft", contactStopped: true });
  assert.equal(
    (
      await db.query("select id from public.drafts where conversation_id=$1", [
        conversation,
      ])
    ).rows.length,
    0,
  );
  await privileged();
  const negative = (
    await row<{ id: string }>(
      "select id from public.workspace_labels where workspace_id=$1 and system_key='not_interested'",
      [workspace],
    )
  ).id;
  await apply({ labelId: negative, shouldReply: true, draft: "Draft" });
  assert.equal(
    (
      await db.query("select id from public.drafts where conversation_id=$1", [
        conversation,
      ])
    ).rows.length,
    0,
  );
  await apply({ shouldReply: true, draft: "Approved draft" });
  assert.equal(
    (
      await db.query("select id from public.drafts where conversation_id=$1", [
        conversation,
      ])
    ).rows.length,
    1,
  );
  await db.query(
    "update public.drafts set body='Human edit',revision=revision+1 where conversation_id=$1",
    [conversation],
  );
  await apply({ shouldReply: true, draft: "Late replacement" });
  assert.equal(
    (
      await row<{ body: string }>(
        "select body from public.drafts where conversation_id=$1",
        [conversation],
      )
    ).body,
    "Human edit",
  );
});

test("Custom rules have stable IDs, unique names and archiving preserves existing assignments", async () => {
  const id = randomUUID();
  const value = {
    name: "Pricing Question",
    group: "positive",
    color: "gray",
    instruction: "Lead explicitly asks about pricing.",
    enabled: true,
    archived: false,
  };
  await user(owner);
  await db.query("select public.save_workspace_label($1,$2,0,$3)", [
    workspace,
    id,
    JSON.stringify(value),
  ]);
  await assert.rejects(
    db.query("select public.save_workspace_label($1,$2,0,$3)", [
      workspace,
      randomUUID(),
      JSON.stringify({ ...value, name: "pricing question" }),
    ]),
  );
  await assert.rejects(
    db.query("select public.save_workspace_label($1,$2,0,$3)", [
      workspace,
      randomUUID(),
      JSON.stringify({ ...value, name: "Unable to categorize" }),
    ]),
  );
  await privileged();
  const revision = (
    await row<{ label_assignment_revision: number }>(
      "select label_assignment_revision from public.conversations where id=$1",
      [conversation],
    )
  ).label_assignment_revision;
  await user(member);
  await db.query("select public.assign_conversation_label($1,$2,$3,2,$4)", [
    workspace,
    conversation,
    id,
    revision,
  ]);
  await user(owner);
  await db.query("select public.save_workspace_label($1,$2,1,$3)", [
    workspace,
    id,
    JSON.stringify({ ...value, archived: true, enabled: false }),
  ]);
  assert.equal(
    (
      await row<{ label_id: string }>(
        "select label_id from public.conversations where id=$1",
        [conversation],
      )
    ).label_id,
    id,
  );
  await assert.rejects(
    db.query("select public.assign_conversation_label($1,$2,$3,2,$4)", [
      workspace,
      conversation,
      id,
      revision + 1,
    ]),
  );
  await assert.rejects(
    db.query("select public.save_workspace_label($1,$2,1,$3)", [
      workspace,
      id,
      JSON.stringify(value),
    ]),
  );
  await db.query("select public.assign_conversation_label($1,$2,null,2,$3)", [
    workspace,
    conversation,
    revision + 1,
  ]);
  assert.equal(
    (
      await row<{ label_state: string }>(
        "select label_state from public.conversations where id=$1",
        [conversation],
      )
    ).label_state,
    "manual_clear",
  );
  assert.equal(
    (
      await db.query(
        "select id from public.conversation_page($1,'','uncategorized')",
        [workspace],
      )
    ).rows.length,
    0,
  );
  // System fields are ignored by the mutation; only availability can change.
  await db.query("select public.save_workspace_label($1,$2,1,$3)", [
    workspace,
    interested,
    JSON.stringify({ ...value, name: "Tampered", enabled: false }),
  ]);
  const system = await row<{ name: string; color: string; enabled: boolean }>(
    "select name,color,enabled from public.workspace_labels where workspace_id=$1 and id=$2",
    [workspace, interested],
  );
  assert.deepEqual(system, {
    name: "Interested",
    color: "green",
    enabled: false,
  });
});

test("Explicit generation records no-reply without replacing a human draft", async () => {
  await privileged();
  await db.query(
    "update public.conversations set label_id=$2,label_source='ai',label_state='classified',contact_stopped=false where id=$1",
    [conversation, meeting],
  );
  const draft = await row<{ id: string; revision: number }>(
    "select id,revision from public.drafts where conversation_id=$1",
    [conversation],
  );
  const generation = randomUUID();
  await user(member);
  await db.query("select public.request_draft_generation($1,$2,$3,2,$4,$5)", [
    workspace,
    generation,
    conversation,
    draft.id,
    draft.revision,
  ]);
  await privileged();
  const catalog = (
    await row<{ label_revision: number }>(
      "select label_revision from public.workspaces where id=$1",
      [workspace],
    )
  ).label_revision;
  const assignment = (
    await row<{ label_assignment_revision: number }>(
      "select label_assignment_revision from public.conversations where id=$1",
      [conversation],
    )
  ).label_assignment_revision;
  await assert.rejects(
    db.query(
      "select public.server_complete_generation_v2($1,$2,'','',false,999,$3,$4,'Already agreed',false)",
      [workspace, generation, catalog, assignment],
    ),
  );
  await db.query(
    "select public.server_complete_generation_v2($1,$2,'','',false,1,$3,$4,'Already agreed',false)",
    [workspace, generation, catalog, assignment],
  );
  assert.deepEqual(
    await row(
      "select status,error_code from public.draft_generations where id=$1",
      [generation],
    ),
    { status: "completed", error_code: "no_reply_needed" },
  );
  assert.equal(
    (
      await row<{ body: string }>(
        "select body from public.drafts where id=$1",
        [draft.id],
      )
    ).body,
    "Human edit",
  );
  assert.equal(
    (
      await row<{ no_reply_reason: string }>(
        "select no_reply_reason from public.conversations where id=$1",
        [conversation],
      )
    ).no_reply_reason,
    "Already agreed",
  );
});

test("Explicit reclassification preserves the old label, deduplicates requests and protects newer edits", async () => {
  await apply();
  await user(viewer);
  await assert.rejects(
    db.query("select public.retry_classification($1,$2)", [
      workspace,
      conversation,
    ]),
  );
  await user(other);
  await assert.rejects(
    db.query("select public.retry_classification($1,$2)", [
      workspace,
      conversation,
    ]),
  );
  await user(member);
  await db.query("select public.retry_classification($1,$2)", [
    workspace,
    conversation,
  ]);
  const pending = await row<{
    label_id: string;
    label_state: string;
    label_assignment_revision: number;
  }>("select * from public.conversations where id=$1", [conversation]);
  assert.equal(pending.label_state, "pending");
  assert.equal(pending.label_id, meeting);
  await db.query("select public.retry_classification($1,$2)", [
    workspace,
    conversation,
  ]);
  await privileged();
  const jobs = (
    await db.query<{ id: string; payload: Record<string, unknown> }>(
      "select id,payload from app_private.jobs where workspace_id=$1 and payload->>'conversationId'=$2 and payload->>'reclassify'='true'",
      [workspace, conversation],
    )
  ).rows;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].payload.generateDraft, false);
  assert.equal(
    jobs[0].payload.assignmentRevision,
    pending.label_assignment_revision,
  );
  // A failure of this exact request is visible, even after an earlier success.
  await db.query("update app_private.jobs set status='failed' where id=$1", [
    jobs[0].id,
  ]);
  assert.equal(
    (
      await row<{ label_state: string }>(
        "select label_state from public.conversations where id=$1",
        [conversation],
      )
    ).label_state,
    "failed",
  );
  assert.equal(
    await apply({}, { assignment: pending.label_assignment_revision - 1 }),
    false,
  );
  assert.equal(await apply({}, { generate: false }), true);
  await db.query("update app_private.jobs set status='failed' where id=$1", [
    jobs[0].id,
  ]);
  assert.equal(
    (
      await row<{ label_state: string }>(
        "select label_state from public.conversations where id=$1",
        [conversation],
      )
    ).label_state,
    "classified",
  );
  await user(member);
  const c = await row<{ label_assignment_revision: number }>(
    "select label_assignment_revision from public.conversations where id=$1",
    [conversation],
  );
  await db.query("select public.assign_conversation_label($1,$2,$3,2,$4)", [
    workspace,
    conversation,
    meeting,
    c.label_assignment_revision,
  ]);
  await db.query("select public.retry_classification($1,$2)", [
    workspace,
    conversation,
  ]);
  assert.equal(
    await apply({}, { generate: false }),
    true,
    "Explicit rerun can replace a manual label",
  );
});

test("Draft intent filters execute in SQL and classification failure cannot erase a newer success", async () => {
  await user(member);
  assert.equal(
    (
      await db.query(
        "select id from public.draft_page($1,p_label=>'group:positive',p_limit=>1)",
        [workspace],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select id from public.draft_page($1,p_label=>'group:negative',p_limit=>1)",
        [workspace],
      )
    ).rows.length,
    0,
  );
  await privileged();
  const job = (
    await row<{ id: string }>(
      "insert into app_private.jobs(workspace_id,kind,dedup_key,payload) values($1,'classify',$2,$3) returning id",
      [
        workspace,
        randomUUID(),
        JSON.stringify({
          conversationId: conversation,
          revision: 2,
          generateDraft: false,
        }),
      ],
    )
  ).id;
  await db.query("update app_private.jobs set status='failed' where id=$1", [
    job,
  ]);
  assert.equal(
    (
      await row<{ label_state: string }>(
        "select label_state from public.conversations where id=$1",
        [conversation],
      )
    ).label_state,
    "classified",
  );
  await db.query(
    "update public.conversations set label_source=null,label_state='pending',classified_revision=0 where id=$1",
    [conversation],
  );
  await db.query("update app_private.jobs set status='failed' where id=$1", [
    job,
  ]);
  assert.equal(
    (
      await row<{ label_state: string }>(
        "select label_state from public.conversations where id=$1",
        [conversation],
      )
    ).label_state,
    "failed",
  );
  await user(member);
  await db.query("select public.retry_classification($1,$2)", [
    workspace,
    conversation,
  ]);
  assert.equal(
    (
      await row<{ label_state: string }>(
        "select label_state from public.conversations where id=$1",
        [conversation],
      )
    ).label_state,
    "pending",
  );
});
