import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
// @ts-expect-error The helper verifies the exact isolated local stack before exposing local-only keys.
import { localConfig } from "../../tools/local-config.mjs";
import {
  encryptConnection,
  decryptConnection,
} from "../../src/server/credentials";
import { loadAIContext } from "../../src/server/ai-context";
import { runNextJob } from "../../src/server/runtime";
import { readConversation, readWorkspace } from "../../src/server/inbox-read";
import { durableSendRepository } from "../../src/server/delivery";
import { sendReply } from "../../src/domain/send";
import {
  normalizeConversation,
  type ProviderConversation,
} from "../../src/integrations/heyreach/client";
import {
  ModelError,
  type InboxModel,
} from "../../src/integrations/ai/classify";

const local = localConfig();
process.loadEnvFile(".env.local");
process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.SUPABASE_SECRET_KEY = local.SERVICE_ROLE_KEY;
const options = { auth: { persistSession: false }, db: { retry: false } };
const admin = createClient<Database>(
  local.API_URL,
  local.SERVICE_ROLE_KEY,
  options,
);
const owner = createClient<Database>(local.API_URL, local.ANON_KEY, options);
const outsider = createClient<Database>(local.API_URL, local.ANON_KEY, options);
let workspace: string, userId: string, agentId: string, conversationId: string;
let token: string;
const run = randomUUID();
const chats = new Map<string, ProviderConversation>();
let modelCalls = 0;
let senderReads = 0;
const model: InboxModel = {
  async classify(input) {
    modelCalls++;
    return {
      labelId: input.labels.find((l) => l.systemKey === "interested")!.id,
      evidenceMessageId:
        input.messages.findLast((m) => m.direction === "inbound")?.id ?? null,
      evidenceQuote:
        input.messages
          .findLast((m) => m.direction === "inbound")
          ?.body.slice(0, 200) ?? "",
      noReplyReason: "",
      contactStopped: false,
      shouldReply: input.generateDraft,
      draft: input.generateDraft ? "Approved local reply." : "",
      missingKnowledge: "",
    };
  },
};
const provider = {
  async verify() {},
  async senders() {
    senderReads++;
    return [
      { id: 42, name: "Local sender", authValid: true },
      { id: 43, name: "New local sender", authValid: true },
    ];
  },
  async conversations() {
    return {
      total: chats.size,
      received: chats.size,
      items: [...chats.values()],
    };
  },
  async chat(senderId: number, id: string) {
    const c = chats.get(id);
    assert.ok(c);
    assert.equal(c.senderId, senderId);
    return c;
  },
};
function must<R extends { data: unknown; error: unknown }>(
  result: R,
): NonNullable<R["data"]> {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.data as NonNullable<R["data"]>;
}
function sql(query: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_ai-inbox-standalone-dev",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: query, encoding: "utf8" },
  );
}
function sample(
  id: string,
  sender = 42,
  body = "Please explain your product.",
  at = new Date(Date.now() - 3600_000).toISOString(),
) {
  return normalizeConversation({
    id,
    linkedInAccountId: sender,
    lastMessageAt: at,
    linkedInAccount: {
      id: sender,
      firstName: "Local",
      lastName: "Sender",
      authIsValid: true,
    },
    correspondentProfile: { firstName: "Test", lastName: "Contact" },
    messages: [{ createdAt: at, body, sender: "THEM" }],
  });
}
async function drain(selectedModel: InboxModel = model) {
  for (let i = 0; i < 100; i++) {
    const remaining = Number(
      sql(
        `select count(*) from app_private.jobs where workspace_id='${workspace}' and status in ('queued','running') and available_at<=now() and (nullif(payload->>'runId','') is null or exists(select 1 from public.import_runs r where r.id::text=payload->>'runId' and r.status in ('queued','running')));`,
      ).trim(),
    );
    if (!remaining) return;
    await runNextJob({
      db: admin,
      model: selectedModel,
      provider: () => provider,
    });
  }
  assert.fail("Queue did not drain");
}
before(async () => {
  for (const [label, client] of [
    ["owner", owner],
    ["outsider", outsider],
  ] as const) {
    const email = `runtime-${run}-${label}@inbox.example`;
    const password = `Local-${run}!`;
    const created = must(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    if (label === "owner") userId = created.user!.id;
    must(await client.auth.signInWithPassword({ email, password }));
  }
  workspace = must(
    await owner.rpc("create_workspace", { p_name: `Runtime ${run}` }),
  );
  agentId = randomUUID();
  must(
    await owner.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agentId,
      p_revision: 0,
      p_config: {
        name: "Runtime agent",
        goal: "Answer questions",
        language: "English",
        replyGroups: ["positive"],
        knowledge: "Approved local facts.",
        status: "active",
      },
    }),
  );
  must(
    await owner.rpc("set_default_agent", {
      p_workspace: workspace,
      p_agent: agentId,
    }),
  );
  const secret = encryptConnection(workspace, `synthetic-key-${run}`);
  token = secret.webhookToken;
  must(
    await admin.rpc("server_connect", {
      p_workspace: workspace,
      p_actor: userId,
      p_ciphertext: secret.ciphertext,
      p_fingerprint: secret.fingerprint,
      p_webhook_hash: secret.webhookHash,
      p_senders: [{ id: 42, name: "Local sender", authValid: true }],
    }),
  );
});

test("Explicit reclassification evaluates afresh, updates the label and never generates a draft", async () => {
  const target = must(
    await owner.rpc("create_workspace", { p_name: `Reclassify ${run}` }),
  );
  const id = randomUUID(),
    message = randomUUID();
  sql(`insert into public.conversations(id,workspace_id,provider_conversation_id,sender_id,sender_name,contact_name,inbound_revision,classified_revision,label_state,label_source)
    values('${id}','${target}','reclassify',42,'Team','Lead',1,1,'uncategorized','ai');
    insert into public.messages(id,workspace_id,conversation_id,ingestion_key,body,direction,source,occurred_at)
    values('${message}','${target}','${id}','reclassify','Yes, please send details.','inbound','provider',now());`);
  const request = { p_workspace: target, p_conversation: id };
  must(await owner.rpc("retry_classification", request));
  must(await owner.rpc("retry_classification", request));
  let calls = 0;
  const classifier: InboxModel = {
    async classify(input) {
      calls++;
      assert.equal(input.previous, undefined);
      assert.equal(input.generateDraft, false);
      return {
        labelId: input.labels.find((l) => l.systemKey === "interested")!.id,
        evidenceMessageId: message,
        evidenceQuote: "Yes, please send details.",
        draft: "",
        missingKnowledge: "",
        shouldReply: false,
        noReplyReason: "",
        contactStopped: false,
      };
    },
  };
  for (let i = 0; i < 20; i++) {
    const pending = sql(
      `select count(*) from app_private.jobs where workspace_id='${target}' and status in ('queued','running')`,
    ).trim();
    if (pending === "0") break;
    await runNextJob({
      db: admin,
      model: classifier,
      provider: () => provider,
    });
  }
  assert.equal(calls, 1);
  const result = must(
    await admin
      .from("conversations")
      .select("label_state,label_id")
      .eq("id", id)
      .single(),
  );
  assert.equal(result.label_state, "classified");
  assert.ok(result.label_id);
  assert.equal(
    must(await admin.from("drafts").select("id").eq("conversation_id", id))
      .length,
    0,
  );
  assert.equal(
    sql(
      `select count(*) from app_private.jobs where workspace_id='${target}' and status='done'`,
    ).trim(),
    "1",
  );
  must(await owner.rpc("retry_classification", request));
  const queued = must(
    await admin
      .from("conversations")
      .select("inbound_revision,label_assignment_revision")
      .eq("id", id)
      .single(),
  );
  must(
    await owner.rpc("assign_conversation_label", {
      ...request,
      p_label: null!,
      p_revision: queued.inbound_revision,
      p_assignment: queued.label_assignment_revision,
    }),
  );
  await runNextJob({ db: admin, model: classifier, provider: () => provider });
  assert.equal(calls, 1, "A newer manual edit supersedes a queued rerun");
  assert.equal(
    must(
      await admin
        .from("conversations")
        .select("label_state")
        .eq("id", id)
        .single(),
    ).label_state,
    "manual_clear",
  );
  assert.equal(
    sql(
      `select count(*) from app_private.jobs where workspace_id='${target}' and status='done'`,
    ).trim(),
    "2",
    "Skipped jobs still finish",
  );
});

test("Provider credentials are encrypted, tenant-bound, and inaccessible through browser RPCs", async () => {
  const stored = must(
    await admin.rpc("server_credentials", { p_workspace: workspace }),
  ) as { ciphertext: string };
  assert.ok(!stored.ciphertext.includes("synthetic-key"));
  assert.equal(
    decryptConnection(workspace, stored.ciphertext).apiKey,
    `synthetic-key-${run}`,
  );
  assert.throws(() => decryptConnection(randomUUID(), stored.ciphertext));
  assert.equal(
    (await owner.rpc("server_credentials", { p_workspace: workspace })).error
      ?.code,
    "42501",
  );
  assert.equal(
    (await outsider.from("senders").select("*").eq("workspace_id", workspace))
      .data?.length,
    0,
  );
  assert.ok(
    (
      await owner.rpc("server_ingest_conversation", {
        p_workspace: workspace,
        p_connection_revision: 1,
        p_data: {},
      })
    ).error,
  );
});
test("Historical import persists messages and classifications but never creates a draft", async () => {
  chats.set("history", sample("history"));
  const id = must(
    await owner.rpc("start_history_import", {
      p_workspace: workspace,
      p_days: 7,
    }),
  );
  await drain();
  const result = must(
    await owner.from("import_runs").select("*").eq("id", id).single(),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.imported, 1);
  assert.equal(result.classified, 1);
  assert.equal(result.inspected, 1);
  const c = must(
    await owner
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspace)
      .eq("provider_conversation_id", "history")
      .single(),
  );
  conversationId = c.id;
  assert.ok(c.label_id);
  assert.equal(c.label_state, "classified");
  assert.equal(c.inbound_revision, 1);
  assert.equal(
    must(await owner.from("drafts").select("id").eq("workspace_id", workspace))
      .length,
    0,
  );
});
test("Authenticated webhook is only a durable hint; duplicate events do not duplicate messages or drafts", async () => {
  const first = chats.get("history")!;
  chats.set("history", {
    ...first,
    messages: [
      ...first.messages,
      ...sample(
        "history",
        42,
        "Interested. Can we see a demo?",
        new Date(Date.now() - 10000).toISOString(),
      ).messages,
    ],
  });
  const url = `http://127.0.0.1:43600/api/webhooks/heyreach/${workspace}`;
  const payload = JSON.stringify({
    event_type: "every_message_reply_received",
    conversation_id: "history",
    sender: { id: 42 },
    message: "Untrusted webhook body must never enter canonical messages",
  });
  assert.equal(
    (await fetch(`${url}?token=invalid`, { method: "POST", body: payload }))
      .status,
    401,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await fetch(`${url}?token=${token}`, {
          method: "POST",
          body: payload,
          headers: { "Content-Type": "application/json" },
        })
      ).status,
      200,
    );
  await drain();
  const messages = must(
    await owner
      .from("messages")
      .select("body")
      .eq("conversation_id", conversationId),
  );
  assert.equal(messages.length, 2);
  assert.equal(
    messages.some((m) => m.body.includes("Untrusted webhook")),
    false,
  );
  const drafts = must(
    await owner
      .from("drafts")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("status", "ready"),
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].body, "Approved local reply.");
  assert.equal(drafts[0].source_revision, 2);
  assert.equal(
    Number(
      sql(
        `select count(*) from app_private.jobs where workspace_id='${workspace}' and kind='sync' and payload->>'runId' is null;`,
      ).trim(),
    ),
    1,
  );
});
test("An identical later webhook still refreshes the chat after its previous job completed", async () => {
  const prior = chats.get("history")!;
  chats.set("history", {
    ...prior,
    messages: [
      ...prior.messages,
      ...sample(
        "history",
        42,
        "One more question.",
        new Date(Date.now() - 5000).toISOString(),
      ).messages,
    ],
  });
  const payload = JSON.stringify({
    event_type: "every_message_reply_received",
    conversation_id: "history",
    sender: { id: 42 },
    message: "Untrusted webhook body must never enter canonical messages",
  });
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:43600/api/webhooks/heyreach/${workspace}?token=${token}`,
        { method: "POST", body: payload },
      )
    ).status,
    200,
  );
  await drain();
  assert.equal(
    must(
      await owner
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId),
    ).length,
    3,
  );
  assert.equal(
    must(
      await owner
        .from("conversations")
        .select("inbound_revision")
        .eq("id", conversationId)
        .single(),
    ).inbound_revision,
    3,
  );
});

test("A new LinkedIn sender is resolved from its HeyReach workspace without an admin profile assignment", async () => {
  const c = sample("new-sender", 43);
  chats.set(c.id, c);
  must(
    await admin.rpc("server_enqueue", {
      p_workspace: workspace,
      p_kind: "sync",
      p_key: randomUUID(),
      p_payload: { conversationId: c.id, senderId: 43, connectionRevision: 1 },
    }),
  );
  await drain();
  assert.equal(senderReads, 1);
  const saved = must(
    await owner
      .from("conversations")
      .select("sender_id")
      .eq("workspace_id", workspace)
      .eq("provider_conversation_id", c.id)
      .single(),
  );
  assert.equal(saved.sender_id, 43);
  assert.equal(
    (
      await admin.rpc("server_refresh_senders", {
        p_workspace: workspace,
        p_revision: 0,
        p_senders: [],
      })
    ).error?.code,
    "PT409",
  );
});
test("Concurrent retries dispatch exactly once; HTTP 200 immediately completes the draft and leaves sending available", async () => {
  const scope = { workspaceId: workspace, userId };
  const draft = must(
    await owner
      .from("drafts")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("status", "ready")
      .single(),
  );
  const repo = durableSendRepository(owner, admin, 1);
  let posts = 0;
  const request = {
    operationId: randomUUID(),
    conversationId,
    body: "First send",
    draft: {
      id: draft.id,
      revision: draft.revision,
      sourceRevision: draft.source_revision,
    },
  };
  const transport = {
    async send() {
      posts++;
      return { status: "sent" as const };
    },
  };
  const results = await Promise.all([
    sendReply(repo, transport, scope, request),
    sendReply(repo, transport, scope, request),
  ]);
  assert.equal(posts, 1);
  assert.ok(results.some((r) => r.status === "sent"));
  assert.equal(
    must(
      await owner.from("drafts").select("status").eq("id", draft.id).single(),
    ).status,
    "sent",
  );
  assert.equal(
    (
      await sendReply(repo, transport, scope, {
        operationId: randomUUID(),
        conversationId,
        body: "A second message",
      })
    ).status,
    "sent",
  );
  assert.equal(posts, 2);
  assert.equal(
    (await sendReply(repo, transport, scope, request)).status,
    "sent",
  );
  assert.equal(posts, 2);
  await assert.rejects(
    sendReply(repo, transport, scope, { ...request, body: "Changed content" }),
  );
  assert.equal(posts, 2);
});
test("Unknown transport outcome is never automatically resent and survives a new repository instance", async () => {
  const scope = { workspaceId: workspace, userId };
  const request = {
    operationId: randomUUID(),
    conversationId,
    body: "Uncertain send",
  };
  let posts = 0;
  assert.equal(
    (
      await sendReply(
        durableSendRepository(owner, admin, 1),
        {
          async send() {
            posts++;
            throw new Error("network timeout");
          },
        },
        scope,
        request,
      )
    ).status,
    "unknown",
  );
  const another = durableSendRepository(owner, admin, 1);
  assert.equal(
    (
      await sendReply(
        another,
        {
          async send() {
            posts++;
            return { status: "sent" as const };
          },
        },
        scope,
        request,
      )
    ).status,
    "unknown",
  );
  await assert.rejects(
    sendReply(
      another,
      {
        async send() {
          posts++;
          return { status: "sent" as const };
        },
      },
      scope,
      { ...request, operationId: randomUUID() },
    ),
  );
  assert.equal(posts, 1);
  assert.equal(
    (
      await owner.rpc("resolve_unconfirmed_send", {
        p_workspace: workspace,
        p_id: request.operationId,
      })
    ).error?.code,
    "PT409",
  );
  sql(
    `update public.send_operations set created_at=now()-interval '2 minutes' where workspace_id='${workspace}' and id='${request.operationId}';`,
  );
  must(
    await owner.rpc("resolve_unconfirmed_send", {
      p_workspace: workspace,
      p_id: request.operationId,
    }),
  );
  assert.equal(
    must(
      await owner
        .from("send_operations")
        .select("status")
        .eq("id", request.operationId)
        .single(),
    ).status,
    "rejected",
  );
});
test("Provider readback merges an acknowledgement and delayed completion preserves a newer inbound draft", async () => {
  const chat = sample("readback-check");
  const ingest = async () =>
    must(
      await admin.rpc("server_ingest_conversation", {
        p_workspace: workspace,
        p_connection_revision: 1,
        p_data: { ...chat, messages: chat.messages.map((m) => ({ ...m })) },
      }),
    );
  await ingest();
  const c = must(
    await owner
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspace)
      .eq("provider_conversation_id", chat.id)
      .single(),
  );
  const scope = { workspaceId: workspace, userId };
  const repo = durableSendRepository(owner, admin, 1);
  const acknowledged = randomUUID();
  await sendReply(
    repo,
    {
      async send() {
        return { status: "sent" };
      },
    },
    scope,
    {
      operationId: acknowledged,
      conversationId: c.id,
      body: "Acknowledged body",
    },
  );
  const firstMessage = must(
    await owner
      .from("messages")
      .select("id")
      .eq("conversation_id", c.id)
      .eq("body", "Acknowledged body")
      .single(),
  );
  chat.messages.push({
    key: "readback-outbound-1",
    body: "Acknowledged body",
    direction: "outbound",
    occurredAt: new Date().toISOString(),
  });
  await ingest();
  await ingest();
  const readback = must(
    await owner
      .from("messages")
      .select("id,source")
      .eq("conversation_id", c.id)
      .eq("body", "Acknowledged body"),
  );
  assert.deepEqual(readback, [{ id: firstMessage.id, source: "provider" }]);
  const delayed = randomUUID();
  assert.equal(
    (
      await repo.reserve(scope, {
        operationId: delayed,
        conversationId: c.id,
        body: "Delayed acknowledgement",
      })
    ).kind,
    "reserved",
  );
  chat.messages.push({
    key: "readback-inbound-2",
    body: "A newer question",
    direction: "inbound",
    occurredAt: new Date(Date.now() + 1000).toISOString(),
  });
  await ingest();
  await drain();
  const newer = must(
    await owner
      .from("drafts")
      .select("id,source_revision,status")
      .eq("conversation_id", c.id)
      .eq("status", "ready")
      .single(),
  );
  assert.equal(newer.source_revision, c.inbound_revision + 1);
  await repo.complete(scope, delayed, { status: "sent" });
  assert.equal(
    must(
      await owner.from("drafts").select("status").eq("id", newer.id).single(),
    ).status,
    "ready",
  );
  chat.messages.push({
    key: "readback-outbound-2",
    body: "Delayed acknowledgement",
    direction: "outbound",
    occurredAt: new Date().toISOString(),
  });
  await ingest();
  assert.equal(
    must(
      await owner.from("drafts").select("status").eq("id", newer.id).single(),
    ).status,
    "ready",
  );
  assert.equal(
    must(
      await owner
        .from("messages")
        .select("id")
        .eq("conversation_id", c.id)
        .eq("body", "Delayed acknowledgement"),
    ).length,
    1,
  );
});

test("Late classification results cannot overwrite an edited draft or assignment", async () => {
  const c = must(
    await owner
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspace)
      .eq("provider_conversation_id", "new-sender")
      .single(),
  );
  const d = must(
    await owner
      .from("drafts")
      .select("*")
      .eq("conversation_id", c.id)
      .eq("status", "ready")
      .single(),
  );
  must(
    await owner.rpc("act_on_draft", {
      p_workspace: workspace,
      p_id: d.id,
      p_revision: d.revision,
      p_action: "edit",
      p_body: "Human-reviewed draft",
    }),
  );
  const ai = await loadAIContext(admin, workspace, c.id);
  const evidence = must(
    await admin
      .from("messages")
      .select("id,body")
      .eq("conversation_id", c.id)
      .eq("direction", "inbound")
      .limit(1)
      .single(),
  );
  const args = {
    p_workspace: workspace,
    p_conversation: c.id,
    p_revision: c.inbound_revision,
    p_assignment: ai.assignmentRevision,
    p_catalog: ai.catalogRevision,
    p_config: ai.configurationVersion,
    p_result: {
      labelId: ai.labels.find((l) => l.systemKey === "interested")!.id,
      evidenceMessageId: evidence.id,
      evidenceQuote: evidence.body,
      shouldReply: true,
      noReplyReason: "",
      contactStopped: false,
      draft: "Late generated replacement",
      missingKnowledge: "",
    },
    p_agent: agentId,
    p_agent_version: 1,
    p_generate: true,
  };
  must(await admin.rpc("server_apply_intent", args));
  assert.equal(
    must(await owner.from("drafts").select("body").eq("id", d.id).single())
      .body,
    "Human-reviewed draft",
  );
  must(await owner.rpc("disconnect_workspace", { p_workspace: workspace }));
  assert.equal(
    must(await admin.rpc("server_apply_intent", args)),
    false,
    "A stale assignment is ignored even when provider is disconnected",
  );
  assert.ok(modelCalls >= 3);
});

test("Explicit redraft is durable, version-bound and cancellation preserves the reviewed draft", async () => {
  const c = must(
    await owner
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspace)
      .eq("provider_conversation_id", "new-sender")
      .single(),
  );
  let d = must(
    await owner
      .from("drafts")
      .select("*")
      .eq("conversation_id", c.id)
      .eq("status", "ready")
      .single(),
  );
  const id = randomUUID();
  must(
    await owner.rpc("request_draft_generation", {
      p_workspace: workspace,
      p_id: id,
      p_conversation: c.id,
      p_source_revision: c.inbound_revision,
      p_draft: d.id,
      p_revision: d.revision,
      p_instructions: "Keep it short",
      p_answer: "Approved answer",
    }),
  );
  const inspecting: InboxModel = {
    async classify(input) {
      assert.equal(input.operator?.instructions, "Keep it short");
      assert.equal(input.operator?.approvedAnswer, "Approved answer");
      assert.equal(input.operator?.currentDraft, "Human-reviewed draft");
      return {
        ...(await model.classify(input)),
        draft: "Short reviewed reply",
      };
    },
  };
  await drain(inspecting);
  assert.equal(
    must(
      await owner
        .from("draft_generations")
        .select("status")
        .eq("id", id)
        .single(),
    ).status,
    "completed",
  );
  d = must(await owner.from("drafts").select("*").eq("id", d.id).single());
  assert.equal(d.body, "Short reviewed reply");
  const cancelled = randomUUID();
  must(
    await owner.rpc("request_draft_generation", {
      p_workspace: workspace,
      p_id: cancelled,
      p_conversation: c.id,
      p_source_revision: c.inbound_revision,
      p_draft: d.id,
      p_revision: d.revision,
    }),
  );
  must(
    await owner.rpc("cancel_draft_generation", {
      p_workspace: workspace,
      p_id: cancelled,
    }),
  );
  await drain({
    async classify() {
      assert.fail("Cancelled generation must not call the model");
    },
  });
  assert.equal(
    must(await owner.from("drafts").select("body").eq("id", d.id).single())
      .body,
    "Short reviewed reply",
  );
});
test("Editing while the model runs rejects the late replacement; model failures are visible", async () => {
  const c = must(
    await owner
      .from("conversations")
      .select("*")
      .eq("workspace_id", workspace)
      .eq("provider_conversation_id", "new-sender")
      .single(),
  );
  let d = must(
    await owner
      .from("drafts")
      .select("*")
      .eq("conversation_id", c.id)
      .eq("status", "ready")
      .single(),
  );
  const id = randomUUID();
  must(
    await owner.rpc("request_draft_generation", {
      p_workspace: workspace,
      p_id: id,
      p_conversation: c.id,
      p_source_revision: c.inbound_revision,
      p_draft: d.id,
      p_revision: d.revision,
    }),
  );
  await drain({
    async classify(input) {
      must(
        await owner.rpc("act_on_draft", {
          p_workspace: workspace,
          p_id: d.id,
          p_revision: d.revision,
          p_action: "edit",
          p_body: "Concurrent human edit",
        }),
      );
      return model.classify(input);
    },
  });
  assert.equal(
    must(
      await owner
        .from("draft_generations")
        .select("error_code")
        .eq("id", id)
        .single(),
    ).error_code,
    "context_changed",
  );
  d = must(await owner.from("drafts").select("*").eq("id", d.id).single());
  assert.equal(d.body, "Concurrent human edit");
  const failed = randomUUID();
  must(
    await owner.rpc("request_draft_generation", {
      p_workspace: workspace,
      p_id: failed,
      p_conversation: c.id,
      p_source_revision: c.inbound_revision,
      p_draft: d.id,
      p_revision: d.revision,
    }),
  );
  await drain({
    async classify() {
      throw new ModelError("model_not_configured");
    },
  });
  const result = must(
    await owner
      .from("draft_generations")
      .select("status,error_code")
      .eq("id", failed)
      .single(),
  );
  assert.deepEqual(result, {
    status: "failed",
    error_code: "model_not_configured",
  });
});
test("A failed historical classification can resume without lost items, duplicate messages or new historical drafts", async () => {
  const secret = encryptConnection(workspace, `synthetic-key-${run}`);
  must(
    await admin.rpc("server_connect", {
      p_workspace: workspace,
      p_actor: userId,
      p_ciphertext: secret.ciphertext,
      p_fingerprint: secret.fingerprint,
      p_webhook_hash: secret.webhookHash,
      p_senders: await provider.senders(),
    }),
  );
  const beforeMessages = must(
    await owner.from("messages").select("id").eq("workspace_id", workspace),
  ).length;
  const beforeDrafts = must(
    await owner.from("drafts").select("id").eq("workspace_id", workspace),
  ).length;
  const id = must(
    await owner.rpc("start_history_import", {
      p_workspace: workspace,
      p_days: 7,
    }),
  );
  await drain({
    async classify() {
      throw new ModelError("model_not_configured");
    },
  });
  assert.equal(
    must(await owner.from("import_runs").select("status").eq("id", id).single())
      .status,
    "failed",
  );
  must(
    await owner.rpc("retry_history_import", {
      p_workspace: workspace,
      p_run: id,
    }),
  );
  await drain();
  const complete = must(
    await owner
      .from("import_runs")
      .select("status,imported,classified")
      .eq("id", id)
      .single(),
  );
  assert.deepEqual(complete, {
    status: "completed",
    imported: 2,
    classified: 2,
  });
  assert.equal(
    must(
      await owner.from("messages").select("id").eq("workspace_id", workspace),
    ).length,
    beforeMessages,
  );
  assert.equal(
    must(await owner.from("drafts").select("id").eq("workspace_id", workspace))
      .length,
    beforeDrafts,
  );
  must(await owner.rpc("disconnect_workspace", { p_workspace: workspace }));
});

test("A hint arriving during a claimed sync schedules another read and stale leases cannot finish it", async () => {
  const key = randomUUID();
  const lease = randomUUID();
  must(
    await admin.rpc("server_enqueue", {
      p_workspace: workspace,
      p_kind: "sync",
      p_key: key,
      p_payload: { conversationId: "history", senderId: 42 },
    }),
  );
  const id = sql(
    `update app_private.jobs set status='running',attempts=1,lease_token='${lease}',lease_until=now()+interval '3 minutes' where workspace_id='${workspace}' and dedup_key='${key}' returning id;`,
  ).split(/\r?\n/)[0];
  must(
    await admin.rpc("server_enqueue", {
      p_workspace: workspace,
      p_kind: "sync",
      p_key: key,
      p_payload: { conversationId: "history", senderId: 42 },
    }),
  );
  assert.equal(
    (await admin.rpc("server_finish_job", { p_id: id, p_lease: randomUUID() }))
      .error?.code,
    "PT409",
  );
  must(await admin.rpc("server_finish_job", { p_id: id, p_lease: lease }));
  assert.equal(
    sql(
      `select status||':'||rerun_requested::text from app_private.jobs where id='${id}';`,
    ).trim(),
    "queued:false",
  );
  sql(`update app_private.jobs set status='done' where id='${id}';`);
});

test("Reply-only import skips model calls, hides outreach in application reads and admits the first live reply", async () => {
  const target = must(
    await owner.rpc("create_workspace", { p_name: "Reply eligibility" }),
  );
  const agent = randomUUID();
  must(
    await owner.rpc("save_agent", {
      p_workspace: target,
      p_id: agent,
      p_revision: 0,
      p_config: {
        name: "Reply agent",
        status: "active",
        goal: "Answer questions",
        knowledge: "Approved fixture facts.",
        language: "English",
        replyGroups: ["positive", "neutral", "negative"],
      },
    }),
  );
  must(
    await owner.rpc("set_default_agent", {
      p_workspace: target,
      p_agent: agent,
    }),
  );
  const secret = encryptConnection(
    target,
    `synthetic-reply-eligibility-${run}`,
  );
  must(
    await admin.rpc("server_connect", {
      p_workspace: target,
      p_actor: userId,
      p_ciphertext: secret.ciphertext,
      p_fingerprint: secret.fingerprint,
      p_webhook_hash: secret.webhookHash,
      p_senders: [{ id: 42, name: "Team sender", authValid: true }],
    }),
  );
  const recent = new Date(Date.now() - 3600_000).toISOString();
  const rawOutgoing = {
    sender: "ME",
    body: "Our outreach question?",
    createdAt: recent,
  };
  const raw = (id: string, messages: object[]) => ({
    id,
    linkedInAccountId: 42,
    lastMessageAt: recent,
    correspondentProfile: { firstName: "Reply", lastName: id },
    messages,
  });
  const outreach = normalizeConversation(raw("outreach", [rawOutgoing]));
  // Eligibility must not depend on the latest message page or the import window.
  const oldReply = {
    sender: "THEM",
    body: "Interested, tell me more.",
    createdAt: new Date(Date.now() - 90 * 86400_000).toISOString(),
  };
  const answered = normalizeConversation(
    raw("answered", [
      oldReply,
      ...Array.from({ length: 55 }, (_, i) => ({
        ...rawOutgoing,
        body: `Our update ${i}`,
      })),
    ]),
  );
  const empty = normalizeConversation(raw("empty", []));
  const fixtures = new Map([outreach, answered, empty].map((c) => [c.id, c]));
  let importedIds = ["outreach", "answered", "empty"];
  let calls = 0;
  const selectedModel: InboxModel = {
    async classify(input) {
      const inbound = input.messages.findLast((m) => m.direction === "inbound");
      if (!inbound)
        assert.equal(
          input.messages.length,
          50,
          "The fixed window does not search older history",
        );
      calls++;
      return {
        labelId: inbound
          ? input.labels.find((l) => l.systemKey === "interested")!.id
          : null,
        evidenceMessageId:
          input.messages.findLast((m) => m.direction === "inbound")?.id ?? null,
        evidenceQuote:
          input.messages
            .findLast((m) => m.direction === "inbound")
            ?.body.slice(0, 200) ?? "",
        noReplyReason: "",
        contactStopped: false,
        shouldReply: input.generateDraft,
        draft: input.generateDraft ? "Reviewed fixture reply." : "",
        missingKnowledge: "",
      };
    },
  };
  const selectedProvider = {
    ...provider,
    async conversations() {
      return {
        total: importedIds.length,
        received: importedIds.length,
        items: importedIds.map((id) => fixtures.get(id)!),
      };
    },
    async chat(sender: number, id: string) {
      assert.equal(sender, 42);
      assert.ok(fixtures.has(id));
      return fixtures.get(id)!;
    },
  };
  async function processJobs() {
    for (let i = 0; i < 60; i++) {
      const pending = Number(
        sql(
          `select count(*) from app_private.jobs where workspace_id='${target}' and status in ('queued','running');`,
        ).trim(),
      );
      if (!pending) return;
      await runNextJob({
        db: admin,
        model: selectedModel,
        provider: (id) => (id === target ? selectedProvider : provider),
      });
    }
    assert.fail("Reply eligibility queue did not finish");
  }
  const firstRun = must(
    await owner.rpc("start_history_import", { p_workspace: target, p_days: 7 }),
  );
  await processJobs();
  assert.equal(calls, 1);
  assert.deepEqual(
    must(
      await owner
        .from("import_runs")
        .select("status,inspected,imported,classified")
        .eq("id", firstRun)
        .single(),
    ),
    { status: "completed", inspected: 3, imported: 1, classified: 1 },
  );
  const hidden = must(
    await admin
      .from("conversations")
      .select("id")
      .eq("workspace_id", target)
      .eq("provider_conversation_id", "outreach")
      .single(),
  ).id;
  const snapshot = await readWorkspace(owner, userId, target);
  assert.equal(snapshot.paging?.conversationTotal, 1);
  assert.deepEqual(
    snapshot.conversations.map((c) => c.providerConversationId),
    ["answered"],
  );
  assert.equal(snapshot.drafts.length, 0);
  await assert.rejects(
    readConversation(owner, target, hidden),
    /Conversation not found/,
  );
  const currentPage = await readConversation(
    owner,
    target,
    snapshot.conversations[0].id,
  );
  assert.ok(
    currentPage.conversation.messages.every((m) => m.direction === "outbound"),
  );
  assert.ok(
    currentPage.next,
    "The qualifying old reply is outside the loaded message page",
  );
  assert.equal(
    must(await outsider.rpc("conversation_page", { p_workspace: target }))
      .length,
    0,
  );

  // An old queued revision-zero job must finish without spending a model call.
  must(
    await admin.rpc("server_enqueue", {
      p_workspace: target,
      p_kind: "classify",
      p_key: randomUUID(),
      p_payload: {
        conversationId: hidden,
        revision: 0,
        generateDraft: false,
        connectionRevision: 1,
      },
    }),
  );
  await processJobs();
  assert.equal(calls, 1);
  assert.deepEqual(
    must(
      await owner
        .from("conversations")
        .select("labels")
        .eq("id", hidden)
        .single(),
    ).labels,
    [],
  );
  importedIds = ["outreach", "empty"];
  const skippedRun = must(
    await owner.rpc("start_history_import", { p_workspace: target, p_days: 7 }),
  );
  await processJobs();
  assert.equal(calls, 1);
  assert.deepEqual(
    must(
      await owner
        .from("import_runs")
        .select("status,inspected,imported,classified")
        .eq("id", skippedRun)
        .single(),
    ),
    { status: "completed", inspected: 2, imported: 0, classified: 0 },
  );

  fixtures.set(
    "outreach",
    normalizeConversation(
      raw("outreach", [
        rawOutgoing,
        {
          sender: "THEM",
          body: "Tell me more.",
          createdAt: new Date().toISOString(),
        },
      ]),
    ),
  );
  const hint = {
    p_workspace: target,
    p_kind: "sync",
    p_key: "first-reply",
    p_payload: {
      conversationId: "outreach",
      senderId: 42,
      connectionRevision: 1,
    },
  };
  must(await admin.rpc("server_enqueue", hint));
  await processJobs();
  const after = await readWorkspace(owner, userId, target);
  assert.equal(after.paging?.conversationTotal, 2);
  const thread = await readConversation(owner, target, hidden);
  assert.deepEqual(
    thread.conversation.messages.map((m) => m.direction),
    ["outbound", "inbound"],
  );
  assert.equal(thread.draft?.status, "ready");
  assert.equal(
    calls,
    3,
    "The first live reply uses separate classification and reply stages",
  );
  must(await admin.rpc("server_enqueue", hint));
  await processJobs();
  assert.equal(calls, 3, "Duplicate delivery must not repeat either AI stage");
  assert.equal(
    (await readConversation(owner, target, hidden)).conversation.messages
      .length,
    2,
  );
});
