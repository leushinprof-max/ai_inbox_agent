import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { runFollowUp } from "../../src/server/follow-up-run";
import { leadPage, readConversation } from "../../src/server/inbox-read";
import { defaultFollowUps } from "../../src/domain/follow-ups";
import type { InboxModel } from "../../src/integrations/ai/classify";
// @ts-expect-error Guarded helper permits only the isolated loopback database.
import { localConfig } from "../../tools/local-config.mjs";

const local = localConfig();
const options = { auth: { persistSession: false }, db: { retry: false } };
const admin = createClient<Database>(
  local.API_URL,
  local.SERVICE_ROLE_KEY,
  options,
);
const owner = createClient<Database>(local.API_URL, local.ANON_KEY, options);
function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  assert.equal(result.error, null);
  assert.notEqual(result.data, null);
  return result.data!;
}
function ok(result: { error: unknown }) {
  assert.equal(result.error, null);
}

test("local PostgREST: the follow-up worker records one writer run, exposes the draft in the existing conversation, and rejects a stale inbound result", async () => {
  const id = randomUUID(),
    agent = randomUUID(),
    conversation = randomUUID();
  const email = `follow-ups-${id}@inbox.example`,
    password = `Local-${id}!`;
  ok(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  ok(await owner.auth.signInWithPassword({ email, password }));
  const workspace = must(
    await owner.rpc("create_workspace", { p_name: `Follow-ups ${id}` }),
  );
  ok(
    await owner.rpc("save_agent", {
      p_workspace: workspace,
      p_id: agent,
      p_revision: 0,
      p_config: {
        name: "Follow-up test",
        status: "active",
        goal: "Book a meeting",
        knowledge: "Approved offer",
        followUps: { ...defaultFollowUps, enabled: true },
      },
    }),
  );
  ok(
    await owner.rpc("set_default_agent", {
      p_workspace: workspace,
      p_agent: agent,
    }),
  );
  const label = must(
    await owner
      .from("workspace_labels")
      .select("id")
      .eq("workspace_id", workspace)
      .eq("system_key", "interested")
      .single(),
  );
  ok(
    await admin.from("conversations").insert({
      id: conversation,
      workspace_id: workspace,
      provider_conversation_id: id,
      sender_id: 1,
      sender_name: "Local sender",
      contact_name: "Local lead",
      inbound_revision: 1,
      classified_revision: 1,
      label_id: label.id,
      label_source: "ai",
      label_state: "classified",
    }),
  );
  for (const [direction, days] of [
    ["inbound", 7],
    ["outbound", 6],
  ] as const)
    ok(
      await admin.from("messages").insert({
        workspace_id: workspace,
        conversation_id: conversation,
        ingestion_key: direction,
        direction,
        body:
          direction === "inbound"
            ? "Please tell me more"
            : "Here is how the inbox works",
        source: "provider",
        occurred_at: new Date(Date.now() - days * 86_400_000).toISOString(),
      }),
    );
  ok(
    await owner.rpc("set_lead_status", {
      p_workspace: workspace,
      p_conversation: conversation,
      p_revision: 1,
      p_status: "follow_up",
    }),
  );
  ok(await admin.rpc("server_schedule_follow_ups"));
  const lead = must(
    await owner
      .from("leads")
      .select("*")
      .eq("workspace_id", workspace)
      .eq("conversation_id", conversation)
      .single(),
  );
  assert.equal(lead.state, "queued");
  let calls = 0;
  const model: InboxModel = {
    async classify(input) {
      calls++;
      assert.equal(input.scenario, "follow_up");
      assert.equal(input.followUp?.attempt, 1);
      assert.equal(input.messages.at(-1)?.direction, "outbound");
      return {
        labelId: label.id,
        evidenceMessageId: null,
        evidenceQuote: "",
        shouldReply: true,
        noReplyReason: "",
        contactStopped: false,
        draft: "Would a short walkthrough help?",
        missingKnowledge: "",
      };
    },
  };
  await runFollowUp({ db: admin, model }, workspace, {
    conversationId: conversation,
    leadRevision: lead.revision,
  });
  assert.equal(calls, 1);
  const result = await readConversation(owner, workspace, conversation);
  assert.equal(result.conversation.lead?.state, "draft");
  assert.equal(result.draft?.followUpNumber, 1);
  const runs = must(
    await admin
      .from("ai_runs")
      .select("scenario,status,request_snapshot")
      .eq("workspace_id", workspace),
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0].scenario, "follow_up");
  assert.equal(runs[0].status, "completed");
  assert.match(JSON.stringify(runs[0].request_snapshot), /Prepare follow-up 1/);
  const page = await leadPage(owner, workspace);
  assert.equal(page.items[0].lead?.state, "draft");
  assert.equal(page.counts.active, 1);
  ok(
    await owner.rpc("set_conversation_agent", {
      p_workspace: workspace,
      p_id: conversation,
      p_revision: 0,
      p_enabled: false,
    }),
  );
  const paused = await readConversation(owner, workspace, conversation);
  assert.equal(paused.conversation.agentEnabled, false);
  assert.equal(
    paused.draft?.id,
    result.draft?.id,
    "pausing keeps the reviewed draft",
  );
  assert.equal((await leadPage(owner, workspace)).items[0].agentEnabled, false);
  await runFollowUp({ db: admin, model }, workspace, {
    conversationId: conversation,
    leadRevision: lead.revision,
  });
  assert.equal(calls, 1, "agent-off jobs never call the model");
  ok(
    await owner.rpc("set_conversation_agent", {
      p_workspace: workspace,
      p_id: conversation,
      p_revision: 1,
      p_enabled: true,
    }),
  );
  assert.equal(
    (await readConversation(owner, workspace, conversation)).conversation
      .agentEnabled,
    true,
  );
  ok(
    await admin.from("messages").insert({
      workspace_id: workspace,
      conversation_id: conversation,
      ingestion_key: "new-inbound",
      direction: "inbound",
      source: "provider",
      body: "Actually let's talk next week",
      occurred_at: new Date().toISOString(),
    }),
  );
  ok(
    await admin
      .from("conversations")
      .update({
        inbound_revision: 2,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversation),
  );
  await runFollowUp({ db: admin, model }, workspace, {
    conversationId: conversation,
    leadRevision: lead.revision,
  });
  assert.equal(calls, 1, "obsolete jobs return before a model call");
  assert.equal(
    (await readConversation(owner, workspace, conversation)).draft,
    null,
  );
});
